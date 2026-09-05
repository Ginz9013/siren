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
 */
const SILENTLY_WRONG = 6;

/**
 * The number of `rejected` cases. The **backlog**: constructs an author is
 * honestly told are not implemented.
 *
 * Measured, not transcribed. `.dev/mermaid-compatibility-gaps.md` totals 35
 * across its three tables; its flowchart table's "rejected" column says 29
 * while the prose under it enumerates 27, and 27 is what running the cases
 * gives.
 */
const REJECTED = 33;

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
