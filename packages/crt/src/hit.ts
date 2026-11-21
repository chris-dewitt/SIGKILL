/**
 * Which word is under a finger.
 *
 * The tube is a picture behind a shader, so a tap lands on a pixel and not on
 * text. Two pure steps get from one to the other: undo where the barrel moved
 * that pixel's content from, then cut the word out of the row it falls in.
 * Both are here, away from the DOM, so they can be tested as arithmetic.
 */

/**
 * Where the content shown at a point on the screen came from, both in 0..1
 * across and down.
 *
 * The same function as `curve()` in the CRT pass, deliberately: the shader
 * samples the source at `curve(uv)` for the pixel at `uv`, so the forward
 * curve already answers "what is drawn here" -- no inverse needed. It is
 * symmetric about the centre, so it does not matter that WebGL counts y from
 * the bottom and the DOM from the top. A curvature of 0 is the flat fallback.
 */
export function unbend(u: number, v: number, curvature: number): { u: number; v: number } {
  if (curvature <= 0) return { u, v };
  const x = u * 2 - 1;
  const y = v * 2 - 1;
  const ox = Math.abs(y) / curvature;
  const oy = Math.abs(x) / curvature;
  return { u: (x + x * ox * ox) * 0.5 + 0.5, v: (y + y * oy * oy) * 0.5 + 0.5 };
}

/** What ends a word on screen: space, table rules, brackets, quotes, commas. */
const SEPARATOR = /[\s|│┃║┆,;()[\]{}<>"'`]/;

/** Punctuation a sentence puts after a word, which is not part of it. */
const TRAILING = /[.:!?]+$/;

/**
 * The word at `col` in `text`, or undefined where there is nothing worth
 * putting on a command line.
 *
 * Paths, hosts, filing ids, units, addresses and `KEY=value` survive whole --
 * `/srv/triage/queue`, `nav-7.service`, `10.40.0.14`, `F-7701` -- because a
 * dot or a colon in the middle of a word is part of it. At the end of one it
 * is the sentence's, and goes. A prompt is not a word anybody wants back.
 */
export function wordAt(text: string, col: number): string | undefined {
  if (col < 0 || col >= text.length || SEPARATOR.test(text[col]!)) return undefined;
  let start = col;
  while (start > 0 && !SEPARATOR.test(text[start - 1]!)) start--;
  let end = col + 1;
  while (end < text.length && !SEPARATOR.test(text[end]!)) end++;
  const word = text.slice(start, end).replace(TRAILING, '');
  if (!/[A-Za-z0-9]/.test(word)) return undefined;
  if (/[$#]$/.test(word)) return undefined;
  return word;
}
