/**
 * The characters the phosphor atlas has already rasterised.
 *
 * `packages/crt` pre-renders printable ASCII, all of box drawing
 * (U+2500–257F) and all of the block elements (U+2580–259F). Anything outside
 * that set still draws — the renderer falls back to `fillText` — but it costs
 * a shaping pass per cell per frame, so art stays inside this vocabulary on
 * purpose rather than by accident.
 *
 * Nothing here is decorative. Every entry is a shape that carries meaning at
 * one character: a wall, a fill level, a join.
 */

/**
 * The width every drawing must survive.
 *
 * `TerminalBuffer`'s own docstring assumes a 34-column phone screen, and
 * `gridFor` floors, so a portrait phone at 13.5px really does land near there.
 * Art wider than this is not wrong — it clips, which is readable — but the
 * important part of a drawing belongs inside it.
 */
export const SAFE_COLS = 34;

export const GLYPHS = {
  /** Single-line box drawing. The ship's own diagrams. */
  light: {
    h: '─', v: '│',
    tl: '┌', tr: '┐', bl: '└', br: '┘',
    t: '┬', b: '┴', l: '├', r: '┤', x: '┼',
  },
  /** Double-line. Reserved for the frame around a whole screen. */
  double: {
    h: '═', v: '║',
    tl: '╔', tr: '╗', bl: '╚', br: '╝',
    t: '╦', b: '╩', l: '╠', r: '╣', x: '╬',
  },
  /** Heavy single-line. A wall that is holding. */
  heavy: {
    h: '━', v: '┃',
    tl: '┏', tr: '┓', bl: '┗', br: '┛',
    t: '┳', b: '┻', l: '┣', r: '┫', x: '╋',
  },
  /** Dashed. A wall that is not holding. */
  broken: {
    h: '╌', v: '╎',
    tl: '┌', tr: '┐', bl: '└', br: '┘',
    t: '┬', b: '┴', l: '├', r: '┤', x: '┼',
  },
  /** Shading, lightest to solid. The whole palette of a blocky picture. */
  shades: [' ', '░', '▒', '▓', '█'],
  /** Eighth-height blocks, for a bar that grows upward. */
  rising: ['▁', '▂', '▃', '▄', '▅', '▆', '▇', '█'],
  /** Eighth-width blocks, for a bar that grows rightward. */
  filling: ['▏', '▎', '▍', '▌', '▋', '▊', '▉', '█'],
  /** Half blocks, for two-pixels-per-cell vertical resolution. */
  half: { top: '▀', bottom: '▄', left: '▌', right: '▐', full: '█' },
} as const;
