import type { Direction } from "../contracts";

/**
 * The direction spellings an author may write, as a regex alternation for the
 * two places that accept one: a `flowchart` header and a class diagram's
 * `direction` statement.
 *
 * `TD` is in this list and deliberately not in `Direction`. That gap *is* the
 * alias, and `normalizeDirection` is the one place it closes — which is the
 * point of this module. Two parsers accepting the same five spellings by way
 * of two regexes and two ternaries is how the two of them drift apart one
 * spelling at a time.
 */
export const DIRECTION_ALTERNATION = "TB|TD|BT|LR|RL";

/**
 * Turns the spelling an author wrote into the one the rest of the pipeline
 * uses. `TD` is Mermaid's alias for `TB`; every other accepted spelling is
 * already canonical.
 *
 * Callers pass a capture group from a regex built on
 * `DIRECTION_ALTERNATION`, so a string outside that set cannot arrive here.
 */
export function normalizeDirection(spelling: string): Direction {
  return spelling === "TD" ? "TB" : (spelling as Direction);
}
