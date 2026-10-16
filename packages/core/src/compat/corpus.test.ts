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
 * Whatever the status, a case also fails on any diagnostic whose message
 * names Mermaid (matched case-insensitively): a diagnostic is for someone
 * fixing their own document, and another tool's name is nothing they can act
 * on. That is all this checks of the wording — whether a message also says
 * how to fix the problem is left to each module's own tests. `COMPAT_CASES`
 * spreads `LABEL_CASES`, so both corpora are held to it.
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
    timelines: [],
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
  const namesMermaid = result.diagnostics.find((d) => /mermaid/i.test(d.message));
  if (namesMermaid !== undefined) {
    return (
      `${entry.id} reported a diagnostic that names Mermaid — ` +
      `${namesMermaid.severity}: ${namesMermaid.message} Reword it without Mermaid's name.`
    );
  }
  if (entry.status === "supported") {
    if (entry.assert === undefined) {
      return (
        `${entry.id} claims "supported" with no \`assert\`. A corpus defect: ` +
        `"parsed with no diagnostics" is exactly what a silent mis-render looks ` +
        `like, so support has to be claimed against meaning. Add an assert, or ` +
        `move the case to the status it deserves.`
      );
    }
    // A warning the row declares is part of the picture it claims; it is
    // required, not merely tolerated, so a row cannot outlive its warning.
    const declared = entry.warnings ?? [];
    const missing = declared.filter(
      (message) =>
        !result.diagnostics.some((d) => d.severity === "warning" && d.message === message),
    );
    if (missing.length > 0) {
      return `${entry.id} claims "supported" with the warning "${missing[0]}", which render() did not report.`;
    }
    const noise = describeDiagnostics({
      ...result,
      diagnostics: result.diagnostics.filter(
        (d) => !(d.severity === "warning" && declared.includes(d.message)),
      ),
    });
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

  it("passes a `supported` entry whose only diagnostics are the warnings it declares", () => {
    const violation = violationOf(
      anyCase({ status: "supported", assert: () => {}, warnings: ["Drawn with the default curve"] }),
      rendered([{ severity: "warning", message: "Drawn with the default curve" }]),
    );
    expect(violation).toBeNull();
  });

  it("fails a `supported` entry whose declared warning was not reported", () => {
    const violation = violationOf(
      anyCase({ status: "supported", assert: () => {}, warnings: ["Drawn with the default curve"] }),
      rendered(),
    );
    expect(violation).toMatch(/Drawn with the default curve/);
  });

  it("still fails a `supported` entry on an error, or on a warning it did not declare", () => {
    const declared = { status: "supported" as const, assert: () => {}, warnings: ["Drawn with the default curve"] };
    const error = violationOf(
      anyCase(declared),
      rendered([
        { severity: "warning", message: "Drawn with the default curve" },
        { severity: "error", message: "Drawn with the default curve" },
      ]),
    );
    const otherWarning = violationOf(
      anyCase(declared),
      rendered([
        { severity: "warning", message: "Drawn with the default curve" },
        { severity: "warning", message: "Node redeclared" },
      ]),
    );
    expect(error).toMatch(/error: Drawn with the default curve/);
    expect(otherWarning).toMatch(/Node redeclared/);
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

describe("the runner's verdict on any entry's diagnostic wording", () => {
  // A diagnostic states the cause and how to fix it, and never names
  // Mermaid: the reader is fixing their own document, and another tool's
  // name is nothing they can act on. Checked whatever the status, so a
  // `rejected` row's error and a `supported` row's declared warning are held
  // to it as well.
  for (const [status, diagnostic] of [
    ["rejected", { severity: "error", message: "Mermaid does not allow this here" }],
    ["supported", { severity: "warning", message: "Drawn as mermaid draws it" }],
  ] as const) {
    it(`fails a \`${status}\` entry whose diagnostic names Mermaid, quoting that diagnostic`, () => {
      const violation = violationOf(
        anyCase({ status, assert: () => {}, warnings: [diagnostic.message] }),
        rendered([diagnostic]),
      );
      expect(violation).toBe(
        `probe reported a diagnostic that names Mermaid — ${diagnostic.severity}: ${diagnostic.message} ` +
          "Reword it without Mermaid's name.",
      );
    });
  }
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
 * `fc-text-label-whitespace` closed the same way: `labelSpan` trims after the
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
 * because the loop is now routed joined to its box (by the ELK layout core,
 * after a stretch of Siren synthesising it under dagre), and the
 * cases that were never written down are written down: `fc-self-edge`,
 * `fc-self-edge-lr` and `st-composite-self-transition`, with
 * `st-self-transition` strengthened from "a loop was drawn" to where it is
 * drawn. A ratchet only counts what someone measured, which is the argument
 * for measuring the whole class the moment one member of it is found.
 *
 * **0 → 2, and the argument of the paragraph above is the whole reason
 * why.** `01M39812J` closed the ER board by measuring the alphabet a
 * bracketless alias may use, walked into Mermaid's own lexer rules from the
 * other side, and found two classes of document this kind draws differently
 * with nothing reporting it. Neither is a regression: nothing here ever
 * worked and stopped. They are case (2) — constructs written down for the
 * first time, as the honest backlog they already were.
 *
 * `er-name-cardinality-word`: a cardinality or body word standing where a
 * name belongs. `CUSTOMER one ORDER` is a parse error in Mermaid and three
 * boxes here, and the multi-word spellings are worse — `zero or one` is a
 * parse error and three boxes. It is **not** the `RESERVED_BARE_NAMES`
 * problem: that set grew one keyword at a time as each became a statement
 * opener, and a cardinality word never was one, so nothing had a reason to
 * reserve it.
 *
 * `er-name-digit-head`: `123abc` is two entities in Mermaid and one box
 * here, because `NUM` is `[0-9]+` with no word boundary. The ticket that
 * found it could not fix it, and the reason is the useful part: the same
 * rule reads two ways in two positions, so the predicate it wrote for the
 * *alias* would refuse `1-2` in the *name* position, where Mermaid draws two
 * boxes. Refusal is the wrong answer there; splitting is the right one.
 *
 * Both exits are implementation. Both were measured by the board that
 * closed rather than by the next one to trip over them — which is the
 * property the paragraph above asks for, and the seventh time this number
 * has turned out to be an undercount. Every one of the seven was found by
 * widening what gets named, never by tightening a ratchet, and this one was
 * found by a ticket about something else entirely.
 *
 * **2 → 0: the ER name position, read as the lexer reads it.** `01M3C621W`
 * made a bare name's head follow Mermaid's INITIAL lexer rule for rule
 * (`bareNameTokenLength`): `er-name-cardinality-word` is refused now, as
 * Mermaid refuses it, and moves to `rejected`; `er-name-digit-head` splits
 * at the end of its number, as Mermaid does, and moves to `supported`.
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
 * label on the same edge, the layout engine (dagre, then) kept space for it,
 * and the text is drawn in that space. Two, exactly as the ticket expected, and **both fell
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
 * `supported`. The block parses, the nodes inside it belong to it, the layout
 * engine (dagre, then) placed the group as a cluster, and the frame is drawn with its title
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
 * diagram's own level reached the layout engine (dagre, then) as the whole graph's rank direction,
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
 *
 * **2 → 0: `er-alias` and `er-direction` are drawn, and the ER backlog is
 * empty.** An entity's bracketed quoted string is read as its alias and
 * titles the box while the authored name stays its `data-siren-id`; a
 * document-level `direction` is read in all four spellings and ranks the
 * diagram, **last statement winning** — measured rather than derived, since
 * `parseStateDiagram` is first-wins and `parseClassDiagram` is last-wins and
 * ER is neither's by inheritance. Both rows assert the drawn SVG, and the
 * direction row does it by **comparing coordinates**: a direction read and
 * dropped leaves every diagnostic empty and still draws a picture, so
 * nothing but where the boxes landed can catch it. `silently-wrong` does not
 * move: both were named refusals, and what replaced each is a picture its
 * row reads back.
 *
 * **0 → 13: the ER board wrote down what it excluded.** Case (2) above,
 * thirteen times over, and the second time a board has closed this way — the
 * State board's own 0 → 6 is the precedent and the wording this paragraph
 * follows. Nothing fell to compensate and nothing broke: every one of the
 * thirteen was *already* refused before this ticket, and what changed is that
 * the gap is now measured instead of remembered. No `supported` row moved,
 * and `silently-wrong` stays 0.
 *
 * Each row's source was re-measured as legal Mermaid against 11.17.2 for the
 * row itself rather than inherited from the ticket that first noticed it, and
 * each `meaning` says what Mermaid's own record holds — which, for three of
 * them, corrected a detail this comment used to state from memory: an ER
 * `subgraph`'s membership lives in the cluster's `nodes` array and **not** in
 * a `parentId` on the entity, `classDef` really does populate `getClasses()`
 * for this kind, and a quoted entity name changes the *id* rather than adding
 * an alias.
 *
 * The ten, grouped by why they were left:
 *
 * - **Two already refused by name**, and the two this comment previously
 *   promised rows for: `er-md-parent-cardinality` (`u`, Mermaid's fifth
 *   cardinality, drawn with no marker at all on that end) and
 *   `er-alias-unquoted` (`A[Unquoted]`, recording the same `alias` field the
 *   quoted spelling does).
 * - **The attribute block's three, ticket `01M394HDP`**:
 *   `er-attribute-generic` (`list~int~ codes` — tildes **kept**, so the cell
 *   draws them), `er-attribute-backtick` (`` `odd name` `` — backticks
 *   **stripped**, so the space survives) and `er-block-one-line`
 *   (`E { string a }`).
 * - **The cluster, ticket `01M395S26`**: `er-subgraph`, a whole construct
 *   rather than a spelling, carrying its own `dir`.
 * - **Author styling, three spellings and no ticket until now**:
 *   `er-style-statement`, `er-style-classdef` and `er-style-class-shorthand`.
 *   ER's grammar has all three terminals and nothing in Siren reads any of
 *   them; measured, they reach exactly the records a flowchart's do.
 *   (Read as history: `01M3977QT` implemented all four spellings — see the
 *   8 → 7 paragraph below for which rows moved and which did not.)
 * - **`accDescr`'s braced spelling**: `er-acc-descr-multiline`, a row that
 *   did not exist before `01M3978B7` and is the one entry here that was
 *   **silently wrong** rather than merely unimplemented — `accDescr {` /
 *   `string x` / `}` drew a second box called `accDescr` with an attribute
 *   in it, saying nothing. Refused by name now. It is counted here rather
 *   than by `SILENTLY_WRONG` because by the time the row was written the
 *   defect was already fixed, and a ratchet counts what the code does
 *   today.
 *
 * Seven of the ten are refused by the **generic** unrecognized-line
 * message rather than by name, which is the state every unimplemented ER
 * construct was already in; naming them belongs to the tickets that implement
 * them, exactly as it did for the attribute trio.
 *
 * `01M3978B7` moved it from thirteen to ten, **minus four plus one**:
 *
 * - `er-acc-title` and `er-acc-descr`, measured to be the flowchart's
 *   arrangement exactly — `<title>`/`<desc>` on the root wired by
 *   `aria-labelledby`/`aria-describedby`, and no `role` written at all,
 *   because real Mermaid writes `role="graphics-document document"` on both
 *   roots and Siren draws that attribute for no kind.
 * - `er-entity-name-quoted`, whose id `reportIdCollisions` now has to hold:
 *   a quoted name can spell `CUSTOMER:ORDER`, which is exactly what a
 *   relationship between `CUSTOMER` and `ORDER` mints.
 * - `er-statements-one-line`, and with it the three gaps that row absorbed.
 * - **Plus** `er-acc-descr-multiline`, found while implementing the two
 *   accessibility rows.
 *
 * Reading a line as a stream of statements is also what made
 * `RESERVED_BARE_NAMES` necessary, and `er-subgraph` is the row that found
 * it: `subgraph sales` / `end` are spelled by the ordinary name alphabet, so
 * a stream without that guard drew three boxes Mermaid draws none for. The
 * row went from a refusal to a silent mis-render and back inside one ticket,
 * which is the argument for a corpus that runs every construct on every
 * change rather than only the one being worked on.
 *
 * **10 → 7: the attribute block's three are drawn, by implementation.** The
 * plainest kind of fall — three rows moved from `rejected` to `supported`,
 * nothing rose to meet them, `silently-wrong` stays 0, and each row's assert
 * now reads the picture back cell by cell instead of naming what is missing.
 *
 * Two of the three were tokenizer rules restored to Mermaid's own order, and
 * the pair is worth keeping side by side because they are **opposites**:
 * `er-attribute-generic` keeps its delimiters (`list~int~` is drawn tildes
 * and all, since the rule's action returns the whole match as one word),
 * while `er-attribute-backtick` loses its own (the backticks emit no token
 * at all, so `` `odd name` `` draws as `odd name`). A reader that treated
 * "quoting" as one idea would get one of them wrong, silently, and the
 * picture is the only place it would show.
 *
 * `er-block-one-line` was **not** the third tokenizer rule, and that is the
 * measurement this ticket turned on. `E { string a }` is not a one-line
 * spelling of a block: a brace is a lexer **condition switch**, so `{` and
 * `}` sit *inside* the statement stream `er-statements-one-line` already
 * records, and a newline is insignificant on both sides of them. Measured,
 * the mode changes mid-line in both directions — `A B { string a }` puts the
 * attribute on `B`, `E { string a } F` is a filled block and then a bare
 * entity, and a block may open mid-line and close two lines later. So the
 * fix was to track the mode across the line rather than to add a pattern,
 * and it closed three spellings nobody had written a row for along with the
 * one that had one.
 *
 * One construct was measured here and deliberately **not** implemented:
 * Mermaid's `` [^`]+ `` matches a newline, so a backticked word may span
 * lines — `` string `a `` over `` b` `` is one attribute named
 * `` a\n    b ``. Siren refuses both halves, honestly and with no picture,
 * and `parseErDiagram`'s rule table says so.
 *
 * **It has a row now: `er-attribute-backtick-multiline`, which is why this
 * literal is 8 and not 7.** That is case (2) — an id that was not in this
 * file before, naming a gap that already existed. The implementing ticket
 * measured it and proposed leaving it unwritten so the number could fall
 * cleanly; the number falling cleanly is not what the number is for. On
 * this project a count that only ever went down has turned out to be an
 * undercount four times — `fc-subgraph-self-edge`, the NaN cluster,
 * `state X`, and `accDescr { }` — and every one of them was found by
 * widening what gets named, never by tightening a ratchet. So the ticket
 * moved three rows down and this one row up, and the arithmetic says so out
 * loud: 10 − 3 + 1.
 *
 * **8 → 7: author styling lands, and the arithmetic is 8 − 2 + 1 rather than
 * the 8 − 3 its ticket predicted.** All four spellings are implemented —
 * `style`, `classDef`, `class` and `:::` — but only two of the three rows
 * that were waiting on them could move, and the third is the interesting
 * one.
 *
 * `er-style-class-shorthand`'s source declares **no `classDef`**, and that
 * was deliberate: the row exists to measure that `:::` needs none, which
 * Mermaid confirms by recording the class and painting nothing. Siren
 * reports `::: applies "urgent", which no classDef defines` at error
 * severity, so the row is still a refusal — but by a different rule than
 * before, and one that belongs to no kind in particular.
 * `01M36C2S4` drew that line deliberately: an unknown **target** is dropped
 * in silence, exactly as Mermaid drops it, while an unknown class **name**
 * still speaks, on the argument that the two are different mistakes and
 * only the first is one Mermaid also tolerates. Reopening it here would
 * have changed flowchart, class and state diagrams from an ER ticket.
 * So the row stays, its `meaning` now names what actually refuses it, and
 * `er-style-class-shorthand-defined` is the new supported row measuring the
 * statement shape on its own. The construct works; the divergence the row
 * now records is Siren being **stricter** than Mermaid, which is worth a
 * number of its own rather than a quiet reclassification.
 *
 * The row that rose is case (2) again, and it is the one this ticket was
 * most at risk of shipping silently. **Every ER entity already wears a
 * class called `default`** — measured from Mermaid's `addEntity`, which
 * creates each one with `cssClasses: "default"` — so `classDef default
 * fill:#abc` paints every box in the document with no `class` statement
 * anywhere. Before this ticket that line was refused because *no* `classDef`
 * was read at all; after it, a reader that simply recorded the definition
 * would accept the statement, apply it to nothing, and draw a different
 * picture from Mermaid's **with no diagnostic** — the one failure mode the
 * compatibility condition rules out outright. `er-style-classdef-default`
 * names it and `parseErDiagram` refuses it, which is how `SILENTLY_WRONG`
 * stays 0 through a ticket that could easily have moved it to 1.
 *
 * ⚠️ **And the same gap is open in the flowchart, unrowed.** Measured on
 * Siren itself, `flowchart TB / classDef default fill:#abc / A` reports no
 * diagnostic and paints nothing, which is precisely the silent divergence
 * refused above. It predates ER styling and lives in files this ticket had
 * no write scope for, so it is named here rather than fixed — the fifth
 * time this count has turned out to be an undercount, and the fifth found
 * by widening what gets named.
 *
 * Four supported rows arrived with the two that moved, and each pins a
 * boundary the picture would otherwise hide:
 * `er-style-statement-swallows-line` and `er-style-class-statement` are the
 * same shape under the two keywords and come out **opposite** ways —
 * `style\b` and `classDef\b` switch Mermaid's lexer into a condition whose
 * only exit is the newline, while `class\b` switches nothing — so a reader
 * treating "a styling keyword" as one idea draws a box Mermaid draws none
 * for, or drops one it draws. `er-style-class-stacked` holds this kind's
 * comma rule, which is **not** the state diagram's: both halves of
 * `class A alpha,beta` split here. And `er-style-classdef-color` holds
 * where an author's `color` lands — the entity's name *and* every attribute
 * cell in its table.
 *
 * **One more row is mine rather than the ticket's, and it is why this
 * literal is 8 and not 7: `er-style-target-colon`.** The ticket measured
 * that no relationship can be styled and drew exactly the right conclusion
 * from it — a relationship id stays out of the style target set, which
 * matters because that id is `${from}:${to}` and so is the first thing an
 * author would type. But it read `style CUSTOMER:ORDER fill:#f96` as
 * painting nothing, and `--markup` says otherwise: `CUSTOMER`'s rect comes
 * out wearing `style=":ORDERfill !important"`, because the `style`
 * condition's word rule has no colon and the grammar concatenates what
 * follows with no separator. Mermaid renders that document **wrongly and
 * silently**, so Siren refusing it is the exception clause working as
 * written — but a refusal nobody wrote down is the thing this file exists
 * to prevent.
 *
 * **8 → 10: ER grows clusters, and the arithmetic is 8 − 1 + 3.** One row
 * fell and three arrived, and all three are case (2) — constructs written
 * down here for the first time, naming gaps nothing had measured. Not one
 * of them can make this number fall by starting to work, because none of
 * them was ever counted as backlog.
 *
 * `er-subgraph` is `supported`: ER really does have `subgraph` clusters,
 * with a per-cluster `dir` that leaves the document's direction alone, and
 * Siren now parses them, hands them to `layoutDirectedGraph` as clusters
 * with a `parentId` and a `rankdir`, grows a frame around what each holds,
 * and draws the two elements `--markup` says mermaid draws — a frame and a
 * title. Three rows arrived `supported` beside it and are not in this
 * count: `er-subgraph-title` (the bracketed header, and the two boundaries
 * around it — a nameless `subgraph` is a parse error here where a
 * flowchart mints `subGraph0`, and the header owns its line),
 * `er-subgraph-nested` (a cluster inside a cluster with the **outer** one
 * carrying the direction — `01M2WQV0`'s NaN shape, which `rankdirFor`
 * already compensates, so `UnplacedNodesError` never fires), and
 * `er-subgraph-duplicate-member` (a name claimed by two blocks goes to the
 * one that **closes** first, which is the inner one when they nest —
 * opening order would draw a perfectly good picture and report nothing).
 *
 * The three that rose are each a construct this one made reachable, and
 * each would otherwise have been **silent**:
 *
 * - `er-subgraph-entity-name` — a name worn by an entity and by a cluster
 *   at once. Measured, mermaid's relationship production calls `addEntity`
 *   on both endpoints and only then asks `subGraphLookup`, so it records a
 *   phantom entity, throws it away in `getData()`, and hands the edge the
 *   **frame**. It draws no box for that name in any ordering. Every
 *   reading Siren's parser has is an ordinary entity, so it would have
 *   drawn a third figure beside the frame with nothing to notice. Its exit
 *   is implementation — an endpoint that resolves to a frame, which
 *   `layoutDirectedGraph` already routes through a representative member.
 * - `er-subgraph-style` and `er-subgraph-class` — ⚠️ **a cluster is a legal
 *   style target in this kind.** Measured from mermaid's own ER database:
 *   `addCssStyles` and `setClass` each look up `this.entities.get(id)`
 *   **and** `this.subGraphLookup.get(id)`, and both directives come back on
 *   the cluster's record. That is the opposite of a relationship, whose id
 *   reaches neither map (`er-style-target-colon`), so the two could not be
 *   reasoned from one another and the assumption that a generated id is
 *   never a style target — true for a flowchart's subgraph — is false here.
 *   Reading them and applying them to nothing would repaint nothing and say
 *   nothing; they are refused by name, and the refusal reads the **order**,
 *   because a `style` written above the block paints nothing in mermaid
 *   either and refusing that would cost a document it draws. Two rows and
 *   not one, for the reason `er-style-class-statement` is a row beside
 *   `er-style-statement`: `style` and `classDef` switch mermaid's lexer
 *   into a condition that runs to the newline and `class` switches nothing.
 *
 * `silently-wrong` is untouched at 0 through a ticket that could easily
 * have moved it to 3, and that is what this rise bought. A count that only
 * ever falls has been an undercount five times on this project; this is the
 * sixth time the fix was to widen what gets named.
 *
 * **10 → 9, where the ticket that moved it expected 8, and the missing one
 * is a decision rather than an omission.** The ER board's two remaining
 * *named* refusals were meant to close together. One did:
 * `er-alias-unquoted` is `supported` — the quotes around an alias are
 * optional, `CUSTOMER[Account]` writes the same `label`/`alias` pair
 * `CUSTOMER["Account"]` writes, and the box draws the alias while the table
 * stays keyed on the authored name. The other stays, and it stays for a
 * reason that had to be read out of Mermaid's source rather than off its
 * SVG.
 *
 * `er-md-parent-cardinality` (`A u--o{ B : x`) is still `rejected`.
 * CONTEXT.md's third rule says that where Mermaid's own output contradicts
 * what the document says, Siren draws what the document says and records
 * the divergence by name — so the question was whether "no marker on the
 * `u` end" is what `MD_PARENT` looks like or a table lookup that failed.
 * It is a lookup that failed, and Mermaid says so itself: `arrowTypesMap`
 * (`chunks/mermaid.core/chunk-OSK3NFVY.mjs`, 11.17.2) carries the four
 * other cardinalities and no `md_parent`, `addEdgeMarker` logs `Unknown
 * arrow type: md_parent` and returns, and the rendered SVG defines eight ER
 * markers with none of them this one. But the third rule then asks Siren to
 * draw what the document says, and **nothing says what figure `MD_PARENT`
 * is**: the only trace of one left in the package is a type declaration
 * (`dist/diagrams/er/erMarkers.d.ts` still names `MD_PARENT_START` and
 * `MD_PARENT_END`) for a module no bundle contains. A rule that cannot be
 * executed is not a licence to guess, and copying the blank would encode a
 * logged internal failure as a construct — a left end an author could not
 * tell from any other, with no diagnostic. So this one exits on a *figure*,
 * from a Mermaid that draws one or a specification that describes one, and
 * the row carries the whole argument.
 *
 * Two things were corrected rather than implemented while that was
 * measured, and both are the instrument catching up rather than code
 * changing. `er-alias-unquoted`'s **source was not valid Mermaid** —
 * `CUSTOMER[Customer Account]` is a parse error, "Expecting 'SQE', got
 * 'UNICODE_TEXT'", because a bracketless alias is a single `entityName`
 * token where a `subgraph` title one construct over is a list of words — so
 * the row had been recording a refusal Siren was right to make for a reason
 * that was not true, and this file's own "if it is not valid Mermaid, it
 * does not belong here" had been broken since the row was seeded. And the
 * `u` refusal read only the lower-case spelling, where Mermaid's lexer is
 * `/i` throughout, so `A U--o{ B : x` was told it was unrecognized instead
 * of unimplemented; it is refused by name now. Neither changes this count.
 *
 * `silently-wrong` is untouched at 0. Both halves of this ticket were named
 * refusals, never wrong pictures — and the alias half could have become one:
 * a bracketless alias read in `NAME_SOURCE` alone would have drawn boxes
 * labelled `to`, `one`, `many`, `1abc` and `end` for five documents Mermaid
 * refuses outright. The alphabet is a lexer question and was answered as
 * one (`readsAsOneEntityName`).
 *
 * **9 → 10: a member written down for the first time.** Case (2) above.
 * The label board's round-3 review measured two class members Mermaid draws
 * as literal characters (`+int <b>id</b>`, `+x<br class="y">z` — escaped in
 * both label modes, `--html`) and Siren refuses as unrecognized, and wrote
 * them down as `cls-member-tags-literal-rejected`. Nothing broke: both were
 * refused before the row existed, `cls-member-tags-literal`'s two spellings
 * still draw, and `silently-wrong` does not move. Never measured until now
 * because the ticket that made members literal measured the two spellings
 * it fixed, not the ones it left.
 *
 * **10 → 14: ADR-0015's refused layers written down for the first time.**
 * Case (2) above. The label board's T11 wrote one row each for the HTML a
 * label may hold that Mermaid draws and SVG text cannot — a table, ruby,
 * `<img>` and a form control (`label-table-rejected`, `label-ruby-rejected`,
 * `label-img-rejected`, `label-form-control-rejected`) — each refused with
 * an error-severity diagnostic at its tag. Nothing broke: before T11 Siren
 * read them as tags outside its vocabulary and drew their text, and no row
 * recorded them. Its review then measured the layers out of context and
 * narrowed them: a table part outside a table is ignored by the parser
 * (`label-stray-table-part`), and seven tags the browser does not show are
 * removed with their content (`label-hidden-tags`). Both new rows are
 * `supported`, and each of the four rejected rows still holds a tag that is
 * refused, so the net is still 14. `silently-wrong` does not move: these
 * refuse pictures Mermaid draws as written, not wrong ones.
 *
 * **14 → 15: a curve written down for the first time.** Case (2) above.
 * The Mermaid-parity board's T7 made `linkStyle … interpolate` a supported
 * spelling for the six curves Siren draws, and wrote down one row,
 * `fc-linkstyle-interpolate-unimplemented-rejected`, for the seven Mermaid
 * draws that Siren does not (`cardinal` and its kin) — refused with an
 * error-severity diagnostic naming the curve. Nothing broke: before T7 every
 * `interpolate` line was refused as an unrecognized style declaration, and
 * no row recorded it. `silently-wrong` does not move.
 *
 * **15 → 14: a stricter rule relaxed to Mermaid's picture.** The direction
 * this number is meant to go. `01M39FAVK` lowered "applies a name no classDef defines" from an
 * error to a warning in the shared `resolveStyles` (decided 2026-10-14):
 * Mermaid 12.2.0 accepts such a name in all four kinds that style, records
 * it and paints nothing. `er-style-class-shorthand`, which was refused only
 * by that rule, draws now and moves to `supported`, asserting the unstyled
 * entity and the warning. `silently-wrong` does not move.
 *
 * **14 → 13: a refused block, read.** `01M4WS1P6` read ER's braced
 * `accDescr { ... }` through the `readAccDescrBlock` the sequence and
 * flowchart parsers share, measured on 12.2.0 to behave identically in all
 * three kinds. `er-acc-descr-multiline` moves to `supported`, asserting the
 * description and that no entity is drawn for the block's body.
 *
 * **13 → 14: case (1), a row leaving `silently-wrong`.** `01M3C621W` made
 * `er-name-cardinality-word` an honest refusal; `silently-wrong` fell by
 * one for it (and by one more for `er-name-digit-head`, which works now),
 * so the sum of the two fell rather than held.
 *
 * **14 → 15: case (2), a divergence written down for the first time.**
 * `01M3BXNYR` (part 2) found that `class A end` — a reserved word in a class
 * list — was read here as "apply the class `end`" while Mermaid 12.2.0
 * refuses the line ("got 'END'"). It was never measured because the guard
 * that reserves those words was asked of names, not of class lists. Siren
 * now refuses it by name, and `er-class-reserved-word` records it. Nothing
 * that rendered stopped rendering: Mermaid draws no picture for it.
 * `silently-wrong` does not move — the old reading drew a warning (no
 * `classDef end`), so it was never silent. The same ticket's
 * `er-style-class-shorthand-relationship` is new and `supported`, and
 * `er-style-target-colon` stays `rejected` with a named refusal now.
 *
 * **15 → 14: a construct started working.** `01M39CT0G`: a backticked
 * attribute word may span lines (Mermaid's `` [^`]+ `` matches a newline),
 * and Siren now reads it as one attribute and draws the cell as Mermaid
 * 12.2.0 does — one row per line, indentation gone.
 * `er-attribute-backtick-multiline` moves to `supported`.
 *
 * **14 → 12: two constructs started working.** `01M3BXN5N`: a `style` or
 * `class` naming an ER `subgraph` block below its `end` paints the cluster —
 * the frame's `<rect>`, and its title for an author's `color` — as Mermaid
 * 12.2.0 does. `er-subgraph-style` and `er-subgraph-class` move to
 * `supported`, asserting the declared value on the drawn frame. The seven
 * rows added beside them (above-block, class-before-classDef,
 * style-beats-class, entity-and-cluster, color, nested, shared-name) are
 * new and `supported`; they pin what was measured, and none moves a count.
 *
 * **12 → 11: a construct started working.** `01M3BXNYR`: a relationship end
 * naming an ER `subgraph` cluster joins the cluster's frame and draws no box
 * for the name, as Mermaid 12.2.0 does — routed by ELK to the frame itself,
 * not through a representative member as the note above once said.
 * `er-subgraph-entity-name` moves to `supported`, asserting the line's end
 * on the frame's boundary. The four rows beside it (relationship above the
 * block — which Mermaid 12.2.0 fails to render, both ends clusters, a
 * cluster to itself, a nested cluster) are new and `supported`.
 *
 * **11 → 12: case (2), a refusal written down for the first time.**
 * `01M4YS7DDX` made `destroy X` wait for its destroying message — the next
 * message, which X must send or receive — and refuses a `destroy` whose next
 * message does not touch X, as Mermaid 12.2.0 refuses the document ("The
 * destroyed participant … does not have an associated destroying message").
 * Siren used to draw it in silence; no row recorded it because nothing
 * measured what `destroy` declares about the message after it.
 * `seq-destroy-without-destroying-message` is that row. Nothing that rendered
 * in Mermaid stopped rendering, and `silently-wrong` does not move.
 *
 * **12 → 14: case (2) again, the `create` side of the same declaration.**
 * `01M4YS7DMG` made `create participant X` wait for its creating message —
 * the next message, which must be sent to X — and refuses a `create` whose
 * next message X sends or that does not touch X, as Mermaid 12.2.0 refuses
 * the document ("The created participant … does not have an associated
 * creating message"). Siren used to draw both in silence; no row recorded
 * them because nothing measured what `create` declares about the message
 * after it. `seq-create-next-message-sent-by-created` and
 * `seq-create-without-creating-message` are those rows. Nothing that
 * rendered in Mermaid stopped rendering, and `silently-wrong` does not move.
 *
 * **14 → 15: a `supported` row moved to `rejected`, under ADR-0001's
 * exception — the one move the ratchet's message forbids, made on purpose.**
 * `01M4YS7DV8` measured what Mermaid 12.2.0 *draws* when a note (or an
 * activation, an `autonumber`, a block boundary, or another `create` or
 * `destroy`) stands between a `create`/`destroy` and its message: it
 * accepts the document and then draws the declaration as if it were never
 * written — C's box at the top, B's lifeline to the bottom — because its
 * drawing pairs a declaration with the record right after it, not with the
 * message its own check paired. `seq-create-note-before-creating-message`
 * had recorded that document as `supported` while the question was open,
 * with Siren drawing what the author meant rather than what Mermaid drew.
 * A wrong picture with no diagnostic is exactly what ADR-0001 lets Siren
 * refuse, and saying why is the obligation that comes with it, so the row
 * is `rejected` now with an error naming what stands in between. What an
 * author loses is a picture Mermaid itself does not draw: moving the note
 * after the message renders in both. `silently-wrong` does not move — the
 * row was never silent-and-wrong in Siren. `seq-destroy-two-at-end`, new
 * beside it, is `supported` and moves nothing.
 *
 * **15 → 16: a `supported` row moved to `rejected`, because its source was
 * never valid Mermaid.** `01M4Z7TQRE` measured what a `%%` in the middle of
 * a line means (CONTEXT.md **Comment**): Mermaid 12.2.0 removes whole-line
 * comments only, and the flowchart grammar refuses a `%%` after a complete
 * statement. `fc-comment-trailing` — `A --> B %% this edge is the point` —
 * had been seeded `supported` on the old belief that `%%` comments run to
 * the end of any line, and Mermaid refuses it ("got 'NODE_STRING'"). Siren
 * refuses it too now (ADR-0017), with an error at the `%%`. What an author
 * loses is a picture Mermaid does not draw either; the comment on its own
 * line renders in both. `fc-comment-mid-line-text`, new beside it, is
 * `supported` — a `%%` inside a label is kept as text, where Siren used to
 * cut the label short — and moves nothing. `silently-wrong` does not move.
 *
 * **16 → 17: case (2), a refusal written down for the first time.**
 * `01M4Z7TQZ4` read a mid-line `%%` in a sequence diagram as Mermaid 12.2.0
 * does: text where its lexer is reading text or a name, a comment only where
 * its own `%%` rules stand at a token boundary. `deactivate B %% x` is one
 * place the name reading refuses the document — Mermaid deactivates a
 * participant named `B %% x`, which has none open ("Trying to inactivate an
 * inactive participant", measured) — and no row recorded it because nothing
 * had measured a mid-line `%%` in a sequence. Siren used to cut the line at
 * the `%%` and draw the deactivation; it refuses it now (ADR-0017), with an
 * error at the `%%`. `seq-comment-after-deactivate` is that row. No
 * `supported` row moved: no sequence row had a mid-line `%%`. The two rows
 * new beside it, `seq-comment-mid-line-text` and
 * `seq-comment-in-participant-name`, are `supported` and move nothing.
 * `silently-wrong` does not move.
 *
 * **17 → 21: case (2), four refusals written down for the first time.**
 * `01M4Z7TR5R` read a mid-line `%%` in class and state diagrams as Mermaid
 * 12.2.0 does: text where the line holds text, a comment where each lexer's
 * own `%%` rule reads one. Two of the new rows are documents Mermaid
 * refuses: `cls-comment-mid-document` — the class lexer's comment rule
 * swallows the line break, so a `%%` after a relationship is a comment only
 * on the last line and refused on any other — and
 * `st-comment-run-into-header`, a `%%` run straight into the header. Two
 * are documents Mermaid accepts and draws as something other than what was
 * written, refused under ADR-0001: `cls-comment-after-annotation` (Mermaid
 * draws a member `<> %% …` for an annotation) and `st-comment-in-class-name`
 * (Mermaid records the class name `busy %% …`, which Siren cannot paint as
 * Mermaid does). Siren used to cut each line at the `%%` and draw it; it
 * refuses each now, with an error at the `%%`. No `supported` row moved: no
 * class or state row had a mid-line `%%`. The four rows new beside them,
 * `cls-comment-mid-line-text`, `cls-comment-last-line`,
 * `st-comment-mid-line-text` and `st-comment-after-token`, are `supported`
 * and move nothing. `silently-wrong` does not move.
 *
 * **21 → 20: a construct started working.** `st-comment-in-class-name` was
 * refused on the belief that Siren could not paint `class Busy busy %% …` as
 * Mermaid does. Rendered (12.2.0, `--markup`), Mermaid writes the recorded
 * name into the node's `class` attribute, so it is split on whitespace and
 * `busy` paints Busy exactly as `class Busy busy` does. Siren now reads a
 * state `class` statement's names one per word and draws the same picture,
 * warning about the names no classDef defines; the row is `supported`.
 * `st-comment-after-note-opener`, new beside it, is `supported` — a block
 * note opener's `%% …` is the note's first row, as Mermaid records it,
 * where `01M4Z7TR5R` had first refused it with no row — and moves nothing. `silently-wrong`
 * does not move.
 *
 * **20 → 21: case (2), a refusal written down for the first time.**
 * `01M4Z7TRCQ` read a mid-line `%%` in ER diagrams as Mermaid 12.2.0 does,
 * the last kind to stop cutting a line at its first `%%`. The ER lexer has
 * no `%` rule, so `er-comment-after-statement` — a `%%` after a
 * relationship — is a document Mermaid refuses ("got '%'"); Siren used to
 * cut the line at the `%%` and draw it, and refuses it now, with an error
 * at the `%%`. No `supported` row moved: no ER row had a mid-line `%%`.
 * `er-comment-mid-line-text`, new beside it, is `supported` and moves
 * nothing. `silently-wrong` does not move.
 *
 * **21 → 24: case (2), three refusals written down for the first time.**
 * `01M4ZWT89B` read a flowchart subgraph title as Mermaid 12.2.0 does: a
 * quoted title with words after it, or several unquoted words, is one
 * title under a generated id. Two of the new rows are documents Mermaid
 * refuses: `fc-subgraph-title-bracket-then-words` (words after a bracketed
 * title, "got 'SPACE'") and `fc-subgraph-title-unquoted-comma` (a `,` in an
 * unquoted title, "got 'COMMA'"). One is a document Mermaid accepts and
 * draws as something other than what was written, refused under ADR-0001:
 * `fc-subgraph-title-trailing-end`, whose last word `end` Mermaid reads as
 * the block's end, swallowing the next line into the title. Siren refused
 * all three before with a generic "Unrecognized flowchart line" and no row;
 * it refuses each now with an error saying how to fix it. No `supported`
 * row moved. The three rows new beside them,
 * `fc-subgraph-title-quoted-then-words`, `fc-subgraph-title-bare-words` and
 * `fc-direction-top-level` (a `direction` outside any subgraph, drawn in
 * the header's direction with a warning), are `supported` and move
 * nothing. `silently-wrong` does not move.
 *
 * **24 → 27: case (2), three refusals written down for the first time.**
 * `01M4ZWT8XF` read a class block closed on a member's line
 * as Mermaid 12.2.0 does: `class A { +int x }` is a whole block, and a `}`
 * may end the last member's line. No row had recorded the documents around
 * that `}`, because Siren refused every one-line block as an unrecognized
 * line until now. Two are ones Mermaid refuses (measured):
 * `cls-class-block-text-after-brace`, text after the `}` on its line
 * ("… got 'ALPHA'"), and `cls-class-block-member-after-brace`, a member on
 * the line below it ("… got 'PLUS'"). One is a document Mermaid accepts and
 * draws as something other than what was written, refused under ADR-0001:
 * `cls-class-block-semicolon-members`, members run together with `;`, which
 * Mermaid draws as one method. Siren refuses each with an error saying what
 * to change. No `supported` row moved.
 * `cls-class-block-one-line` and `cls-class-block-closed-on-member-line`,
 * new beside them, are `supported` and move nothing. `silently-wrong` does
 * not move.
  *
 * **27 → 30: case (2), three refusals written down for the first time.**
 * `01M4ZWT94S` refused a single `%` in an ER entity's quoted name or alias,
 * as Mermaid 12.2.0 does: its lexer reads such a string as `WORD`, which no
 * entity production takes ("got 'WORD'"). Siren drew each before, with no
 * row to say so; `er-percent-in-alias`, `er-percent-in-quoted-name` and
 * `er-percent-in-relationship-end` write them down. No `supported` row
 * moved: no ER row had a `%` in a quoted name. `er-percent-in-label-and-comment`,
 * new beside them, is `supported` and moves nothing. `silently-wrong` does
 * not move.
 *
 * **30 → 32: case (2), two refusals written down for the first time.**
 * `01M4ZWT94S`'s review found the same `WORD` in an ER subgraph header:
 * Mermaid 12.2.0 refuses a `%` in its quoted name or title ("got 'WORD'",
 * measured), and Siren drew the cluster, with no row to say so;
 * `er-percent-in-subgraph-name` and `er-percent-in-subgraph-title` write
 * them down. No `supported` row moved: no ER row had a `%` in a subgraph
 * header. `silently-wrong` does not move.
 *
 * **32 → 33: case (2), a refusal written down for the first time.**
 * `01M4ZWT8XF`'s review refused a `;` between two class members wherever
 * it stands outside a method's parentheses and a `~generic~`, not only
 * where Siren could not read the text: Mermaid 12.2.0 draws
 * `+int age; int legs` as one attribute and `+run(); +stop()` as one
 * method (measured), a picture of neither pair of members, refused under
 * ADR-0001. Siren used to draw each as that one member, as Mermaid does,
 * with no row to say so; `cls-class-block-semicolon-readable-members`
 * writes it down. No `supported` row moved: no supported row has a `;`
 * between members. `silently-wrong` does not move.
 *
 * **33 → 36: case (2), three refusals written down for the first time.**
 * `01M4ZY2DA1` read a namespace block written on one line as Mermaid
 * 12.2.0 does: the text after its `{` is its first statement, and a `}`
 * closes it wherever it stands. No row had recorded the documents around
 * that `}`, because Siren refused every one-line namespace as an
 * unrecognized line until now. Two are ones Mermaid refuses (measured):
 * `cls-namespace-empty`, a namespace with no statement ("… got
 * 'STRUCT_STOP'"; Siren used to accept the multi-line spelling, drawing no
 * frame), and `cls-namespace-text-after-brace`, text after the `}` on its
 * line ("… got 'ALPHA'"). One is a document Mermaid accepts and draws as
 * something other than what was written, refused under ADR-0001:
 * `cls-namespace-two-classes-one-line`, which Mermaid draws as the one
 * class `LionclassTiger`. No `supported` row moved.
 * `cls-namespace-one-line` and `cls-namespace-closed-on-statement-line`,
 * new beside them, are `supported` and move nothing. `silently-wrong` does
 * not move.
 *
 * **36 → 40: case (2), four refusals written down for the first time.**
 * `01M4ZWT8G2` refused an unquoted `[ ] { }` and an unpaired `(` or `)` in
 * a flowchart node label, as Mermaid 12.2.0 does (`fc-text-unquoted-bracket`,
 * which Siren drew before), and gave three refusals Siren already made an
 * explanation each: `@{ … }` node data (`fc-node-shape-data`), an edge id
 * (`fc-edge-id`) and a `linkStyle` word with no `:`
 * (`fc-linkstyle-not-a-declaration`), none of which had a row. No
 * `supported` row moved: none held such a label. `silently-wrong` does not
 * move.
 *
 * **40 → 41: case (2), a refusal written down for the first time.**
 * `01M4ZWT8PR`'s review refused an `&` without a space on each side
 * (`fc-group-ampersand-unspaced`). Mermaid 12.2.0 reads one glued to an id
 * as a character of it — `A&B-->C` is the one node `A&B` (measured), a
 * picture other than the group written, refused under ADR-0001 — and one
 * spaced on a single side as a parse error. Siren used to draw the group,
 * with no row to say so. No `supported` row moved: none glued an `&`.
 * `silently-wrong` does not move.
 *
 * **41 → 42: case (2), a refusal written down for the first time.**
 * `01M51B43T8` read a dotted namespace name (`namespace Zoo.Cats`) as
 * Mermaid 12.2.0 does, the `Cats` inside Zoo. Siren refused every dotted
 * name as an unrecognized line until now, so no row had recorded the dotted
 * names Mermaid refuses: `cls-namespace-dotted-empty-part`, a name with an
 * empty part (`Zoo..Cats`, `.Zoo`, `Zoo.`; "… got 'DOT'", measured), now
 * one error at the name saying what to write. No `supported` row moved.
 * `cls-namespace-dotted`, new beside it, is `supported`. `silently-wrong`
 * does not move.
 *
 * **42 → 43: case (2), a refusal written down for the first time.**
 * `01M51DSEGE` refused every statement but a class declaration, a note and
 * a nested namespace inside a namespace body, as Mermaid 12.2.0 does
 * ("Expecting 'NAMESPACE', 'CLASS', 'NOTE_FOR', 'NOTE', got …", measured).
 * Siren used to draw a relationship, a `style`, an inline member and the
 * rest there as if written outside, with no row to say so:
 * `cls-namespace-body-statement` writes it down. No `supported` row moved:
 * none wrote such a statement in a namespace. `silently-wrong` does not
 * move.
 *
 * **43 → 44: case (2), a refusal written down for the first time.**
 * `01M51DSEQ3` refused every `;` in an inline member (`A : +int x; y`,
 * `A : +foo(a; b)`, `A : +int x;`), as Mermaid 12.2.0's lexer does
 * ("Lexical error … Unrecognized text" at the `;`, measured), an entity
 * code's own `;` aside. Siren used to draw the first two, with no row to
 * say so: `cls-inline-member-semicolon` writes it down. No `supported` row
 * moved: none wrote a `;` in an inline member. `silently-wrong` does not
 * move.
 *
 * **44 → 45: case (2), a refusal written down for the first time.**
 * `01M51DSEXR` refused a space between two words of a namespace name
 * (`namespace Big Zoo {`) with one error saying how to write it. Mermaid
 * 12.2.0 draws the frame `BigZoo` (measured), a name nobody wrote, refused
 * under ADR-0001. Siren already refused the line, as an unrecognized one
 * with a second error at its `}`, with no row to say so:
 * `cls-namespace-name-with-space` writes it down. No `supported` row
 * moved. `silently-wrong` does not move.
 *
 * **45 → 46: case (2), a refusal written down for the first time.**
 * `01M51K83NB` refused a top-level class-diagram line holding `direction
 * TB|BT|RL|LR` anywhere in it, which Mermaid 12.2.0's lexer reads as one
 * direction statement, the rest of the line gone with no diagnostic
 * (measured: a label, an inline member, a relationship), across a line
 * break too. Siren used to draw a label, an inline member, a relationship
 * label, a generic, an annotation, a note's text, `accTitle`, `accDescr`, a
 * `click`, `link` or `callback` string and a `style` line holding one, and
 * refused a class declaration, a relationship or `note "x"` followed by
 * one, a glued form, `classDef`, `cssClass`, a mid-line `%%` and a one-line
 * namespace (as unrecognized lines, a `classDef` for its declaration, a
 * mid-line `%%` for the `%%`), with no row to say so:
 * `cls-direction-inside-line` writes it down. No `supported` row moved:
 * none wrote a direction inside a line. `silently-wrong` does not move.
 *
 * **46 → 49: case (2), three refusals written down for the first time.**
 * `01M51Q7G098SYMMW8BCGM22H2R` refused a class diagram's `direction TD`,
 * which Mermaid 12.2.0's class lexer has no rule for: `direction LR` then
 * `direction TD` is laid out left to right (measured), a picture other than
 * the one written, refused under ADR-0001. Siren used to read it as TB, with
 * no row to say so: `cls-direction-td` writes it down. It refused text after
 * the `}` closing a class diagram's `accDescr { ... }` on its line, which
 * Mermaid refuses ("Expecting 'NEWLINE', 'EOF', got …", measured) and Siren
 * used to read as the next statement: `cls-accdescr-text-after-brace`. And
 * it gave `class C direction XX`, which Mermaid draws as the one class
 * `CdirectionXX` (measured) and Siren already refused as an unrecognized
 * line, an error saying so: `cls-class-then-direction-value`. No
 * `supported` row moved: none wrote `direction TD` or text after an
 * `accDescr { }` block in a class diagram. `silently-wrong` does not move.
 *
 * **49 → 50: one row falls, and case (2), two refusals written down for the
 * first time.** `01M51Q7F65QMNVZN545S28D4CN` read a flowchart
 * node's `@{ … }` block for the 45 shape names that are one of Siren's
 * fourteen shapes, and its `label`: `fc-node-shape-data`, refused until
 * now, is `supported` (−1). The rest of the block is refused as before, now
 * with a row each: `fc-node-shape-data-undrawn`, a shape Mermaid 12.2.0
 * draws and Siren has no geometry for (`cloud`), and
 * `fc-node-shape-data-icon`, a key Siren does not draw (`icon`) (+2). No
 * `supported` row moved to `rejected`. `fc-node-shape-data-names`, new
 * beside them, is `supported`. `silently-wrong` does not move.
 *
 * **50 → 51: case (2), a refusal written down for the first time.**
 * `01M51Q7G6R5TY4NGMMNCMJ9JVJ` read a `~generic~` on a class relationship's
 * ends and refused one on a lollipop `()` end, which names an interface:
 * Mermaid 12.2.0 draws that interface with its tildes as written (`Duck~T~`,
 * measured), neither a generic nor the name alone, refused under ADR-0001.
 * Siren used to refuse the whole line as unrecognized, with no row to say
 * so: `cls-lollipop-generic` writes it down. No `supported` row moved:
 * `cls-relationship-generic`, new beside it, is `supported`.
 * `silently-wrong` does not move.
 *
 * **51 → 52: case (2), a refusal written down for the first time.**
 * `01M51Q7FCNVAMK9FKX5BPC8BNZ` refused a flowchart id that begins with a
 * keyword Mermaid 12.2.0's lexer reads before an id (`end`, `style`,
 * `class`, `graph`, …) followed by a character that is not
 * `[A-Za-z0-9_]`. At the top level Mermaid refuses each, so no row records
 * them; inside a subgraph `end-x` is the block's end and then a node `-x`
 * (measured), a picture nobody wrote, refused under ADR-0001. Siren used to
 * report that block as unterminated, with no row to say so:
 * `fc-id-end-prefix-in-subgraph` writes it down. No `supported` row moved:
 * none wrote such an id. `silently-wrong` does not move.
 *
 * **52 → 55: case (2), three refusals written down for the first time.**
 * `01M51RR6AJKAR05VBT12A2BSB4` refused three class-diagram generics Mermaid
 * 12.2.0 draws as something other than written, with no diagnostic
 * (measured, Chrome), under ADR-0001: a generic given after the class was
 * first named without one (`class Box` then `class Box~T~` draws `Box`),
 * `cls-generic-after-first-naming`, which Siren used to draw `Box<T>`; a
 * `<` opening a tag in a generic (`class Box~List<int>~` draws
 * `Box<List>`), `cls-generic-tag`, which Siren used to draw
 * `Box<List<int>>`; and a note's target naming a generic its class does
 * not have (`note for Box~T~` on a `Box~U~`), `cls-note-generic-mismatch`,
 * which Siren used to refuse as an unrecognized line, with no row to say
 * so. No `supported` row moved: `cls-generic-forms`, new beside them, is
 * `supported`. `silently-wrong` does not move.
 *
 * **55 → 56: case (2), a refusal written down for the first time.**
 * `01M51Q7FK5E65XVPWJYGYPN1ST` read a flowchart `%%` where an endpoint
 * begins as the start of an id, as Mermaid 12.2.0 does, and kept refusing
 * one after a `;`, which Mermaid draws as a node an author writing a
 * comment did not mean (ADR-0001), now saying so:
 * `fc-percent-after-semicolon` writes it down. Siren refused it before as a
 * mid-line `%%`, with no row to say so. No `supported` row moved.
 * `fc-percent-id-and-arrowless-group`, new beside it, is `supported`.
 * `silently-wrong` does not move.
 *
 * **56 → 58: case (2), two refusals written down for the first time.**
 * `01M51TMV71BF1Y0EC2RS2B6ZWG` refused a class
 * generic other than the one the class was first named with
 * (`cls-generic-conflict`) and a second, different annotation
 * (`cls-annotation-conflict`): Mermaid 12.2.0 drops the later one with no
 * diagnostic (measured, Chrome), refused under ADR-0001. Siren used to
 * draw the first with a warning, with no row to say so. No `supported` row
 * moved: `cls-generic-break`, new beside them, is `supported`.
 *
 * **58 → 60: case (2), two refusals written down for the first time.**
 * `01M51Q7FSSKCM7EH7K2SB1NKR8` read a flowchart class name as Mermaid
 * 12.2.0 styles it, measured in headless Chrome: a name that makes the CSS
 * rule `.<name> > *` parse is drawn styled, one that does not stops the
 * diagram rendering. `fc-class-name-not-css` (`classDef 1c`), which Siren
 * drew before, is refused now (ADR-0017); `fc-class-name-comma`
 * (`class A c,d`), the one class `c,d` Mermaid draws unstyled, is refused
 * under ADR-0001 where Siren refused it before as an unrecognized line, with
 * no row to say so. No `supported` row moved: none used such a name.
 * `fc-class-name-punctuation`, new beside them, is `supported`.
 * `silently-wrong` does not move.
 *
 * **60 → 65: case (2), five refusals written down for the first time.**
 * `01M51XADJKSGRYG5CM1GG0T91R` read a flowchart edge's own id
 * (`fc-edge-id-timeline`, `supported`) and refused the five ways of writing
 * one that Mermaid 12.2.0 draws other than as written (ADR-0001) or that
 * leave Siren's id space: an id on an arrow joining a group
 * (`fc-edge-id-group`), one a node holds (`fc-edge-id-names-a-node`), one
 * another edge holds (`fc-edge-id-repeated`), a block on it written above
 * the edge (`fc-edge-id-data-before-edge`), and one outside the id alphabet
 * (`fc-edge-id-alphabet`). Siren refused every edge id before, with
 * `fc-edge-id` the one row to say so. No `supported` row moved.
 * `silently-wrong` does not move.
 *
 * **65 → 69: case (2), four refusals written down for the first time.**
 * `01M51XADJKSGRYG5CM1GG0T91R`'s follow-up refused an edge id that names a
 * subgraph (`fc-edge-id-names-a-subgraph`), and a `click`, `style` or
 * `class` naming an edge id (`fc-edge-id-click`, `fc-edge-id-style`,
 * `fc-edge-id-class`). Siren drew the subgraph case, the `style` and the
 * `class` without a word, and refused the click as naming nothing. No
 * `supported` row moved. `silently-wrong` does not move.
 *
 * **69 → 70: case (2), a refusal written down for the first time.**
 * `01M51XAENDSMY3Y9QDXW1674GP` refused a class diagram's `direction td`
 * and `direction TD x` as `direction TD` is: Mermaid 12.2.0 sets no
 * direction for either and keeps the one before (measured, Chrome), refused
 * under ADR-0001. Siren refused both before as unrecognized lines, with no
 * row to say so: `cls-direction-td-spelling` writes it down. No `supported`
 * row moved: `cls-member-punctuation`, `cls-member-markers-only`,
 * `cls-member-repeated` and `cls-method-last-paren`, new beside it, are
 * `supported`. `silently-wrong` does not move.
 *
 * **70 → 71: case (2), a refusal written down for the first time.**
 * `01M51XACB6WMSE98954326VAZ7` drew the shapes Mermaid 12.2.0 draws with no
 * text (`fc-node-shape-data-labelless`, `fc-node-shape-data-labelless-lr`,
 * `supported`) and refused a label written for one
 * (`fc-node-shape-data-labelless-label`): Mermaid empties it and draws the
 * bare shape (measured, Chrome), refused under ADR-0001. Siren refused every
 * one of these shapes before, as not drawn yet. No `supported` row moved.
 * `silently-wrong` does not move.
 *
 * **71 → 72: case (2), a refusal written down for the first time.**
 * `01M51Z1XFFERJ5P7G4WATQMJ74` refused a class diagram's `direction` whose
 * value sets nothing — `direction lr`, `direction XX`, a bare `direction` —
 * as `direction TD` is: Mermaid 12.2.0 keeps the direction before
 * (measured, Chrome), refused under ADR-0001, naming the one to write.
 * Siren refused each before as an unrecognized line, with no row to say so:
 * `cls-direction-value-case` writes it down. No `supported` row moved:
 * `cls-member-visibility-space`, `cls-method-nameless` and
 * `cls-member-empty-line`, new beside it, are `supported`.
 * `silently-wrong` does not move.
 *
 * **72 → 70: two rows supported.** `01M51XAE8BFH3E4K0KPYZ26GC7` drew a
 * flowchart edge's `@{ animate: true }` (`fc-edge-id`) and applied a
 * `classDef` to an edge id (`fc-edge-id-class`), each refused before.
 * `fc-edge-data-animation-and-curve`, new beside them, is `supported`.
 * `silently-wrong` does not move.
 *
 * **70 → 71: case (2), a refusal written down for the first time.** A
 * `style`, `class` or `:::` naming a small circle or an anchor, which
 * Mermaid 12.2.0 draws in their own paint whatever the declaration says
 * (measured, Chrome), refused under ADR-0001
 * (`fc-node-shape-data-own-paint-style`). Siren drew it before, with the
 * declaration applied, and no row said so. No `supported` row moved.
 * `silently-wrong` does not move.
 *
 * **71 → 73: one row falls, three refusals written down for the first
 * time.** `01M51XACZJ8QSCSGEDZE7M4XDK` drew icon nodes from packs the
 * caller registers: `fc-node-shape-data-undrawn` (`shape: icon`) moved from
 * `rejected` to `supported` (71 → 70). It refused an icon `form`, a `pos`
 * and an `h` Mermaid 12.2.0 draws silently wrong (`fc-node-icon-form-unknown`,
 * `fc-node-icon-pos-unknown`, `fc-node-icon-size-invalid`; measured, Chrome),
 * under ADR-0001 (70 → 73). Siren refused every icon key before, as not
 * supported yet, with `fc-node-shape-data-icon` the one row to say so; that
 * row stays `rejected`, now for an icon whose pack is not registered. No
 * `supported` row moved. `silently-wrong` does not move.
 */
const REJECTED = 73;

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
