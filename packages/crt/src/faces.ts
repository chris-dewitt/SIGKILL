import type { LineKind } from './buffer.js';

/**
 * How a line kind sits on the page.
 *
 * Colour is already a meaning. Weight and italic are the other two levers a
 * real terminal has, and they are what make ORACLE's name recede as a label
 * while the sentence carries, and the line you just typed stand up as a
 * command. Size stays off the CRT grid — a larger heading would break the
 * column count — and lives in the last-turn strip instead.
 */
export interface TypeFace {
  weight: 400 | 600 | 700;
  italic: boolean;
}

export const LINE_FACES: Record<LineKind, TypeFace> = {
  out: { weight: 400, italic: false },
  err: { weight: 400, italic: true },
  echo: { weight: 700, italic: false },
  system: { weight: 400, italic: false },
  speaker: { weight: 700, italic: false },
  command: { weight: 600, italic: false },
  path: { weight: 400, italic: false },
  value: { weight: 700, italic: false },
  flag: { weight: 400, italic: true },
  heading: { weight: 700, italic: false },
  good: { weight: 600, italic: false },
  warn: { weight: 600, italic: false },
  muted: { weight: 400, italic: false },
};

const FALLBACK: TypeFace = { weight: 400, italic: false };

/** CSS font shorthand with the kind's weight and italic applied. */
export function faceFont(base: string, kind: string): string {
  const face = (LINE_FACES as Record<string, TypeFace>)[kind] ?? FALLBACK;
  const style = face.italic ? 'italic' : 'normal';
  return `${style} ${face.weight} ${base}`;
}
