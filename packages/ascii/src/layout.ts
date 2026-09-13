/**
 * A drawing: one string per row, top to bottom.
 *
 * Rows are allowed to be ragged. Every function here that cares about
 * rectangularity calls `pad` first rather than demanding it of the caller,
 * because the whole point of hand-authored art is that you can type it.
 */
export type Art = readonly string[];

/** The width of the widest row. */
export function width(art: Art): number {
  return art.reduce((max, row) => Math.max(max, row.length), 0);
}

/**
 * Pad every row to the same width with spaces.
 *
 * This is what makes composition work: `beside` cannot align two blocks whose
 * rows end wherever the author stopped typing.
 */
export function pad(art: Art, to = width(art)): string[] {
  return art.map((row) => (row.length >= to ? row : row + ' '.repeat(to - row.length)));
}

/** Truncate every row to `cols`. The renderer does this too; this is for tests. */
export function clip(art: Art, cols: number): string[] {
  return art.map((row) => row.slice(0, Math.max(0, cols)));
}

/** Put blocks one above another, with `gap` blank rows between. */
export function stack(blocks: Art[], gap = 0): string[] {
  const out: string[] = [];
  for (const [index, block] of blocks.entries()) {
    if (index > 0) for (let i = 0; i < gap; i++) out.push('');
    out.push(...block);
  }
  return out;
}

/**
 * Put two blocks side by side, top-aligned.
 *
 * The left block is padded to rectangular first, or the right one steps left
 * on every row the author happened to type short.
 */
export function beside(left: Art, right: Art, gap = 1): string[] {
  const l = pad(left);
  const lw = width(l);
  const rows = Math.max(l.length, right.length);
  const spacer = ' '.repeat(Math.max(0, gap));
  const blank = ' '.repeat(lw);

  const out: string[] = [];
  for (let i = 0; i < rows; i++) {
    out.push((l[i] ?? blank) + spacer + (right[i] ?? ''));
  }
  // Trailing spaces on a row whose right side ran out are meaningless.
  return out.map((row) => row.replace(/ +$/, ''));
}

/**
 * Lay blocks out in a grid, row-major.
 *
 * Cells are padded to the widest cell in the whole grid rather than per
 * column, because a ship diagram of equal compartments should look like one.
 */
export function grid(cells: Art[][], gap = 1): string[] {
  const all = cells.flat();
  if (all.length === 0) return [];
  const cellWidth = Math.max(...all.map(width));
  const out: string[] = [];

  for (const [index, row] of cells.entries()) {
    if (index > 0) out.push('');
    const height = Math.max(...row.map((cell) => cell.length));
    const padded = row.map((cell) => pad([...cell, ...Array(height - cell.length).fill('')], cellWidth));
    for (let line = 0; line < height; line++) {
      out.push(padded.map((cell) => cell[line] ?? '').join(' '.repeat(Math.max(0, gap))).replace(/ +$/, ''));
    }
  }
  return out;
}

/** Centre every row inside `cols`. Leading spaces only — trailing are dropped. */
export function centre(art: Art, cols: number): string[] {
  return art.map((row) => {
    const slack = cols - row.length;
    return slack <= 0 ? row : ' '.repeat(Math.floor(slack / 2)) + row;
  });
}

/** Shift a block right. Blank rows stay blank rather than becoming spaces. */
export function indent(art: Art, by: number): string[] {
  const prefix = ' '.repeat(Math.max(0, by));
  return art.map((row) => (row.length === 0 ? row : prefix + row));
}
