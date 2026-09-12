/**
 * Grid arithmetic. No canvas, no DOM — so it can be tested, and so the
 * awkward cases (a keyboard eating half the screen, a device pixel ratio of
 * 2.75) are provably handled rather than hopefully handled.
 */

export interface CellSize {
  width: number;
  height: number;
}

export interface GridSize {
  cols: number;
  rows: number;
}

export interface Viewport {
  /** CSS pixels available to the terminal. */
  width: number;
  height: number;
  /** devicePixelRatio. Canvas is sized in device pixels and scaled back. */
  dpr: number;
}

/** Minimum usable grid. Below this the terminal is not worth drawing. */
export const MIN_COLS = 20;
export const MIN_ROWS = 4;

/**
 * How many whole cells fit.
 *
 * Floors, because a partial column would clip mid-glyph and a partial row
 * would show a sliver of text the player cannot read. Clamped to a minimum
 * so a transient zero-height layout (which Android produces while the
 * keyboard animates) cannot produce a zero or negative grid.
 */
export function gridFor(viewport: Viewport, cell: CellSize): GridSize {
  if (cell.width <= 0 || cell.height <= 0) return { cols: MIN_COLS, rows: MIN_ROWS };
  return {
    cols: Math.max(MIN_COLS, Math.floor(viewport.width / cell.width)),
    rows: Math.max(MIN_ROWS, Math.floor(viewport.height / cell.height)),
  };
}

/** Canvas backing-store size in device pixels, capped so a 4× DPR tablet does not allocate a surface it cannot afford. */
export function backingSize(viewport: Viewport, maxDpr = 2): { width: number; height: number; scale: number } {
  const scale = Math.min(Math.max(viewport.dpr, 1), maxDpr);
  return {
    width: Math.max(1, Math.round(viewport.width * scale)),
    height: Math.max(1, Math.round(viewport.height * scale)),
    scale,
  };
}

/**
 * Which rows to draw.
 *
 * `scroll` is how many rows the player has scrolled back from the bottom.
 * Clamped both ways: past the top shows the top, and a buffer shorter than
 * the viewport pins to zero rather than producing a negative index.
 */
export function visibleRange(total: number, rows: number, scroll: number): { start: number; end: number } {
  const maxScroll = Math.max(0, total - rows);
  const clamped = Math.min(Math.max(0, Math.round(scroll)), maxScroll);
  const start = Math.max(0, total - rows - clamped);
  return { start, end: Math.min(total, start + rows) };
}

/** Is the view pinned to the newest output? Determines whether new lines auto-scroll. */
export function atBottom(total: number, rows: number, scroll: number): boolean {
  return visibleRange(total, rows, scroll).end >= total;
}

/**
 * Codepoints the atlas pre-renders.
 *
 * Printable ASCII covers everything the shell emits. Box drawing is there for
 * the diegetic ASCII art the spec calls for — a map the ship draws itself.
 * Anything outside this set falls back to drawing the glyph directly, which
 * is slower but never wrong.
 */
export function atlasCodepoints(): number[] {
  const points: number[] = [];
  for (let c = 0x20; c <= 0x7e; c++) points.push(c);
  for (let c = 0x2500; c <= 0x257f; c++) points.push(c); // box drawing
  for (let c = 0x2580; c <= 0x259f; c++) points.push(c); // block elements
  points.push(0x2022, 0x00b7, 0x2026, 0x2190, 0x2191, 0x2192, 0x2193);
  return points;
}

/** Where a codepoint sits in an atlas of `columns` slots per row. */
export function slotPosition(index: number, columns: number): { col: number; row: number } {
  return { col: index % columns, row: Math.floor(index / columns) };
}

/** Square-ish atlas: enough columns that the texture is not a long ribbon. */
export function atlasColumns(count: number): number {
  return Math.max(1, Math.ceil(Math.sqrt(count)));
}
