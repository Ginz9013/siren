/**
 * Whether `value` is written in CSS color syntax — the one test a label's
 * `color` and `background-color` (`<span style>`, and `<font color>`) are
 * held to before they are drawn.
 *
 * A browser drops a declaration whose value it cannot parse, so Mermaid's
 * picture of `background-color: banana` has no background at all; Siren
 * handed the same value to SVG would paint the fallback, black, over the
 * text. So a value that is not a color is read as unwritten, as the board's
 * span-style rule says of every invalid value.
 *
 * Syntax, not meaning: a named color, `transparent`, `currentcolor`, a hex
 * color of 3, 4, 6 or 8 digits, one of the color functions with its
 * parentheses closed, or a `var(--…)` the theme may resolve. A function's
 * arguments are not checked — a browser drops a call it cannot read, and the
 * renderer writes the value as an attribute, never as markup.
 */
export function isCssColor(value: string): boolean {
  const lowered = value.trim().toLowerCase();
  return (
    NAMED_COLORS.has(lowered) ||
    /^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/.test(lowered) ||
    /^(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color|color-mix)\(.*\)$/.test(lowered) ||
    /^var\(\s*--[\w-]+\s*(?:,.*)?\)$/.test(lowered)
  );
}

/** CSS Color 4's named colors, with the two keywords that name a color too. */
const NAMED_COLORS: ReadonlySet<string> = new Set(
  `transparent currentcolor aliceblue antiquewhite aqua aquamarine azure beige bisque black
   blanchedalmond blue blueviolet brown burlywood cadetblue chartreuse chocolate coral
   cornflowerblue cornsilk crimson cyan darkblue darkcyan darkgoldenrod darkgray darkgreen
   darkgrey darkkhaki darkmagenta darkolivegreen darkorange darkorchid darkred darksalmon
   darkseagreen darkslateblue darkslategray darkslategrey darkturquoise darkviolet deeppink
   deepskyblue dimgray dimgrey dodgerblue firebrick floralwhite forestgreen fuchsia gainsboro
   ghostwhite gold goldenrod gray green greenyellow grey honeydew hotpink indianred indigo ivory
   khaki lavender lavenderblush lawngreen lemonchiffon lightblue lightcoral lightcyan
   lightgoldenrodyellow lightgray lightgreen lightgrey lightpink lightsalmon lightseagreen
   lightskyblue lightslategray lightslategrey lightsteelblue lightyellow lime limegreen linen
   magenta maroon mediumaquamarine mediumblue mediumorchid mediumpurple mediumseagreen
   mediumslateblue mediumspringgreen mediumturquoise mediumvioletred midnightblue mintcream
   mistyrose moccasin navajowhite navy oldlace olive olivedrab orange orangered orchid
   palegoldenrod palegreen paleturquoise palevioletred papayawhip peachpuff peru pink plum
   powderblue purple rebeccapurple red rosybrown royalblue saddlebrown salmon sandybrown seagreen
   seashell sienna silver skyblue slateblue slategray slategrey snow springgreen steelblue tan
   teal thistle tomato turquoise violet wheat white whitesmoke yellow yellowgreen`.split(/\s+/),
);
