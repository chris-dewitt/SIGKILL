import { GLYPHS } from './glyphs.js';
import { pad, width, type Art } from './layout.js';

/**
 * Which wall to draw.
 *
 * The choice is diegetic, not cosmetic: `heavy` is a bulkhead that is holding,
 * `broken` is one that is not. A player who has seen both once can read a deck
 * map without a legend, which is the entire reason to draw one.
 */
export type FrameStyle = 'light' | 'double' | 'heavy' | 'broken';

export interface FrameOptions {
  style?: FrameStyle;
  /** Text inset into the top wall. Clipped if the box is too narrow for it. */
  title?: string;
  /** Spaces between the wall and the contents, left and right. */
  padding?: number;
  /** Force an outer width. Narrower than the contents clips them. */
  cols?: number;
}

/**
 * Draw a box around a block.
 *
 * Contents are padded rectangular first, so every row's right wall lands in
 * the same column -- the single most common way hand-drawn terminal art comes
 * out looking broken.
 */
export function frame(contents: Art, opts: FrameOptions = {}): string[] {
  const g = GLYPHS[opts.style ?? 'light'];
  const padding = opts.padding ?? 1;
  const gutter = ' '.repeat(padding);

  const inner = Math.max(
    1,
    opts.cols !== undefined ? opts.cols - 2 - padding * 2 : width(contents),
  );
  const body = pad(contents, inner).map((row) => `${g.v}${gutter}${row.slice(0, inner)}${gutter}${g.v}`);

  return [top(g, inner + padding * 2, opts.title), ...body, bottom(g, inner + padding * 2)];
}

/** The top wall, with the title inset one character in from the left corner. */
function top(g: (typeof GLYPHS)[FrameStyle], span: number, title?: string): string {
  if (title === undefined || title.length === 0) return g.tl + g.h.repeat(span) + g.tr;
  // ` TITLE ` needs two spaces plus one wall segment either side to read as
  // inset rather than as a title that has burst its box.
  const label = ` ${title} `;
  if (label.length + 2 > span) return g.tl + g.h.repeat(span) + g.tr;
  return g.tl + g.h + label + g.h.repeat(span - label.length - 1) + g.tr;
}

function bottom(g: (typeof GLYPHS)[FrameStyle], span: number): string {
  return g.bl + g.h.repeat(span) + g.br;
}

/**
 * A rule with a label on it, for separating sections without boxing them.
 *
 *     ── ACT I COMPLETE ────────────────
 *
 * Cheaper than a frame and reads as a chapter break rather than a readout,
 * which is the difference between the ship telling you something and the ship
 * showing you something.
 */
export function caption(label: string, cols: number, style: FrameStyle = 'light'): string {
  const h = GLYPHS[style].h;
  const text = label.length > 0 ? ` ${label} ` : '';
  const lead = h.repeat(2);
  const tail = Math.max(0, cols - lead.length - text.length);
  return lead + text + h.repeat(tail);
}
