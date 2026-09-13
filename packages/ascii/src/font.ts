/**
 * A 5×3 block font.
 *
 * Every one of the thirteen games needs its name up front, so the alphabet
 * lives here rather than in any one of them. Three columns per glyph is the
 * narrowest a letter can be and stay a letter, which is what lets a seven
 * character title fit inside `SAFE_COLS` with room to breathe.
 *
 * It is deliberately not a complete font. Letters get added when a title needs
 * them; `blockWord` renders an unknown character as a blank so a missing glyph
 * is a gap rather than a crash.
 */
const GLYPHS: Record<string, readonly [string, string, string, string, string]> = {
  A: [' █ ', '█ █', '███', '█ █', '█ █'],
  B: ['██ ', '█ █', '██ ', '█ █', '██ '],
  C: [' ██', '█  ', '█  ', '█  ', ' ██'],
  D: ['██ ', '█ █', '█ █', '█ █', '██ '],
  E: ['███', '█  ', '██ ', '█  ', '███'],
  F: ['███', '█  ', '██ ', '█  ', '█  '],
  G: [' ██', '█  ', '█ █', '█ █', ' ██'],
  H: ['█ █', '█ █', '███', '█ █', '█ █'],
  I: ['███', ' █ ', ' █ ', ' █ ', '███'],
  J: ['  █', '  █', '  █', '█ █', ' █ '],
  K: ['█ █', '█ █', '██ ', '█ █', '█ █'],
  L: ['█  ', '█  ', '█  ', '█  ', '███'],
  M: ['█ █', '███', '███', '█ █', '█ █'],
  N: ['██ ', '█ █', '█ █', '█ █', '█ █'],
  O: [' █ ', '█ █', '█ █', '█ █', ' █ '],
  P: ['██ ', '█ █', '██ ', '█  ', '█  '],
  Q: [' █ ', '█ █', '█ █', '███', '  █'],
  R: ['██ ', '█ █', '██ ', '█ █', '█ █'],
  S: [' ██', '█  ', ' █ ', '  █', '██ '],
  T: ['███', ' █ ', ' █ ', ' █ ', ' █ '],
  U: ['█ █', '█ █', '█ █', '█ █', '███'],
  V: ['█ █', '█ █', '█ █', '█ █', ' █ '],
  W: ['█ █', '█ █', '███', '███', '█ █'],
  X: ['█ █', '█ █', ' █ ', '█ █', '█ █'],
  Y: ['█ █', '█ █', ' █ ', ' █ ', ' █ '],
  Z: ['███', '  █', ' █ ', '█  ', '███'],
  '0': [' █ ', '█ █', '█ █', '█ █', ' █ '],
  '1': [' █ ', '██ ', ' █ ', ' █ ', '███'],
  '2': ['██ ', '  █', ' █ ', '█  ', '███'],
  '3': ['██ ', '  █', ' █ ', '  █', '██ '],
  '4': ['█ █', '█ █', '███', '  █', '  █'],
  '5': ['███', '█  ', '██ ', '  █', '██ '],
  '6': [' ██', '█  ', '███', '█ █', '███'],
  '7': ['███', '  █', ' █ ', ' █ ', ' █ '],
  '8': ['███', '█ █', '███', '█ █', '███'],
  '9': ['███', '█ █', '███', '  █', '██ '],
  '-': ['   ', '   ', '███', '   ', '   '],
  '.': ['   ', '   ', '   ', '   ', ' █ '],
  ' ': ['   ', '   ', '   ', '   ', '   '],
};

/** How tall every glyph is. Callers laying out around a word need this. */
export const FONT_ROWS = 5;

/** How wide a word will be, before it is rendered. */
export function blockWidth(word: string, tracking = 1): number {
  if (word.length === 0) return 0;
  return word.length * 3 + (word.length - 1) * tracking;
}

/**
 * Render a word in block capitals.
 *
 * Lower case is upper-cased rather than refused: a title is a title. Trailing
 * spaces are trimmed, because the gap after the last letter is not part of
 * the drawing.
 */
export function blockWord(word: string, tracking = 1): string[] {
  const rows = Array.from({ length: FONT_ROWS }, () => '');
  const gap = ' '.repeat(Math.max(0, tracking));

  for (const [index, ch] of [...word.toUpperCase()].entries()) {
    const glyph = GLYPHS[ch] ?? GLYPHS[' ']!;
    for (let r = 0; r < FONT_ROWS; r++) {
      rows[r] += (index > 0 ? gap : '') + glyph[r];
    }
  }
  return rows.map((row) => row.replace(/ +$/, ''));
}
