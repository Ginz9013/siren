import { DEFAULT_TYPOGRAPHY } from "siren-core";
import type { Typography } from "siren-core";

/**
 * The typography a theme sets through its `--siren-*` tokens: the three
 * sizes core lays out at, plus the font family only a measurer needs (core
 * never sees it — see the theme-typography ADR).
 */
export interface BoardTypography extends Typography {
  fontFamily: string;
}

/** The family `--siren-font-family` is in the default theme (`default.css`). */
export const DEFAULT_FONT_FAMILY = "system-ui, sans-serif";

/** A plain px length, as a theme writes the size tokens: `14px`, `16.5px`. */
const PX = /^(\d+(?:\.\d+)?|\.\d+)px$/;

/** `value` as a number of px when it is a positive px length, else `fallback`. */
function px(value: string, fallback: number): number {
  const match = PX.exec(value);
  if (match === null) return fallback;
  const size = Number(match[1]);
  return size > 0 ? size : fallback;
}

/**
 * Reads `--siren-font-family`, `--siren-font-size`, `--siren-label-font-size`
 * and `--siren-title-font-size` off `element`'s computed style. A token that
 * is empty — jsdom resolves no custom property, so always there — or is not
 * a positive px length (`1.5rem`, `calc(…)`, `0px`) takes the default
 * theme's value for that field alone: board cannot resolve other units.
 */
export function readTypography(element: Element): BoardTypography {
  const style = window.getComputedStyle(element);
  const token = (name: string) => style.getPropertyValue(`--siren-${name}`).trim();
  return {
    fontFamily: token("font-family") || DEFAULT_FONT_FAMILY,
    fontSize: px(token("font-size"), DEFAULT_TYPOGRAPHY.fontSize),
    labelFontSize: px(token("label-font-size"), DEFAULT_TYPOGRAPHY.labelFontSize),
    titleFontSize: px(token("title-font-size"), DEFAULT_TYPOGRAPHY.titleFontSize),
  };
}
