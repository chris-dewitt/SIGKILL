import { GlyphAtlas, scaleFont } from './atlas.js';
import type { LineKind, Row, TerminalBuffer } from './buffer.js';
import { backingSize, gridFor, visibleRange, type GridSize } from './metrics.js';

/**
 * A colour for every `LineKind`, plus the ground they sit on.
 *
 * Typed off `LineKind` rather than listed again here, so a new kind without a
 * colour is a compile error rather than a character that silently draws in the
 * wrong one. What each name *means* is documented on `LINE_KINDS`.
 *
 * Loud on purpose. The first pass at this was a restrained green phosphor with
 * two quiet accents, which is historically accurate and hard to read: on a
 * phone, in daylight, a wall of one hue is a wall. These are the sixteen
 * colours a terminal has always had, at the brightness people actually set
 * them to -- distinct hues for distinct meanings, so a glance finds the
 * command, the path and the number without reading a word.
 */
export type Palette = Record<LineKind, string> & { background: string };

export const PHOSPHOR: Palette = {
  background: '#06080b',
  /** Ordinary output: the classic terminal green, turned up. */
  out: '#4dff91',
  /** The adventure's prose. Near-white, because it is *writing* and gets read. */
  system: '#dceaff',
  /** Who is speaking. Magenta marks the name without shouting the sentence. */
  speaker: '#ff6ac1',
  /** Something you could type. The brightest thing on the screen, deliberately. */
  command: '#3ff0ff',
  /** A path or filename. */
  path: '#7aa2ff',
  /** A number that matters. */
  value: '#ffe066',
  /** A flag or option. */
  flag: '#c792ea',
  /** A title, a rule, the frame of a box. */
  heading: '#ffa24a',
  /** Done, running, sealed, healthy. */
  good: '#3dff6e',
  /** Worth your attention, not yet an error. */
  warn: '#ffb01f',
  /** Something went wrong. */
  err: '#ff5f56',
  /** The line you typed, echoed back. */
  echo: '#ffffff',
  /** Present but deliberately quiet. */
  muted: '#5f7f70',
};

export interface RendererOptions {
  font: string;
  palette?: Palette;
  /** Left and right padding in CSS pixels. */
  gutter?: number;
  /**
   * Fraction of each edge reserved for the CRT curve, 0..0.2.
   *
   * The barrel distortion pushes the image outward, so the corners of a flat
   * grid fall off the tube. Without this the last column of a full-width line
   * is simply not on screen -- which looks like a wrapping bug and is not.
   * Zero when the shader is off, because then nothing bends.
   */
  overscan?: number;
}

/**
 * Draws the buffer onto a 2D canvas.
 *
 * Deliberately dumb: it blits glyphs and knows nothing about the CRT, which
 * is a separate pass over whatever this produces. Keeping them apart means
 * the shader can be disabled — on a device without WebGL2, or for a player
 * who finds the persistence uncomfortable — and the text still renders.
 */
export class TerminalRenderer {
  readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private atlas: GlyphAtlas;
  private readonly palette: Palette;
  private readonly gutter: number;
  private readonly overscan: number;
  private readonly font: string;
  private scale = 1;
  private grid: GridSize = { cols: 20, rows: 4 };
  private originX = 0;
  private originY = 0;

  constructor(opts: RendererOptions) {
    this.font = opts.font;
    this.palette = opts.palette ?? PHOSPHOR;
    this.gutter = opts.gutter ?? 16;
    this.overscan = Math.min(Math.max(opts.overscan ?? 0, 0), 0.2);

    this.canvas = document.createElement('canvas');
    const ctx = this.canvas.getContext('2d', { alpha: false });
    if (!ctx) throw new Error('TerminalRenderer: 2d context unavailable');
    this.ctx = ctx;

    this.atlas = new GlyphAtlas({
      font: this.font,
      scale: 1,
      colors: this.atlasColors(),
    });
  }

  /**
   * One tinted sheet per line kind, plus one in the background colour.
   *
   * That last sheet is the cursor: a filled block in the line's own colour
   * with the glyph punched out of it in the background colour, which is what
   * reverse video is and what every terminal draws a block cursor with.
   */
  private atlasColors(): Record<string, string> {
    const { background, ...rest } = this.palette;
    // Every palette entry can be drawn, plus the cursor. Sheets are built on
    // first use, so a colour the adventure never reaches costs nothing.
    return { ...rest, cursor: background };
  }

  get columns(): number {
    return this.grid.cols;
  }

  get rows(): number {
    return this.grid.rows;
  }

  /** Re-measure for a new viewport. Rebuilds the atlas only if the scale changed. */
  resize(width: number, height: number, dpr: number): void {
    const backing = backingSize({ width, height, dpr });

    if (backing.scale !== this.scale) {
      this.scale = backing.scale;
      this.atlas = new GlyphAtlas({
        font: this.font,
        scale: this.scale,
        colors: this.atlasColors(),
      });
    }

    this.canvas.width = backing.width;
    this.canvas.height = backing.height;

    // Reserve the curved edges before dividing into cells.
    const inset = width * this.overscan;
    const insetY = height * this.overscan;
    this.grid = gridFor(
      {
        width: Math.max(0, width - this.gutter * 2 - inset * 2),
        height: Math.max(0, height - insetY * 2),
        dpr,
      },
      this.atlas.cell,
    );
    this.originX = Math.round((this.gutter + inset) * this.scale);
    this.originY = Math.round(insetY * this.scale);
  }

  /**
   * Draw.
   *
   * `scroll` is rows back from the newest output; 0 is pinned to the bottom.
   */
  render(buffer: TerminalBuffer, scroll = 0): void {
    const ctx = this.ctx;
    const cellW = Math.ceil(this.atlas.cell.width * this.scale);
    const cellH = Math.ceil(this.atlas.cell.height * this.scale);

    ctx.fillStyle = this.palette.background;
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

    const laid = buffer.layout(this.grid.cols);
    const { start, end } = visibleRange(laid.length, this.grid.rows, scroll);

    // Only the fallback path draws text directly, but the font has to be set
    // before it is needed, not inside the per-glyph loop.
    ctx.font = scaleFont(this.font, this.scale);
    ctx.textBaseline = 'top';

    for (let i = start; i < end; i++) {
      const row = laid[i];
      if (!row) continue;
      this.drawRow(row, this.originX, this.originY + (i - start) * cellH, cellW, cellH);
    }
  }

  private drawRow(row: Row, left: number, top: number, cellW: number, cellH: number): void {
    // The atlas is keyed by colour name, and a line's kind *is* its colour.
    // Spans override it for the characters they cover.
    const colors = colorRuns(row);

    // The block goes down before any glyph, so the character it sits under is
    // drawn on top of it rather than being painted over.
    if (row.cursor !== undefined) {
      this.ctx.fillStyle = this.palette[row.kind];
      this.ctx.fillRect(left + row.cursor * cellW, top, cellW, cellH);
    }

    for (let n = 0; n < row.text.length; n++) {
      const ch = row.text[n];
      if (ch === undefined) continue;
      const onCursor = n === row.cursor;
      // A space matters under the cursor: the block is the only thing to see.
      if (ch === ' ' && !onCursor) continue;

      const color = colors === undefined ? row.kind : (colors[n] ?? row.kind);
      const x = left + n * cellW;
      if (this.atlas.draw(this.ctx, onCursor ? 'cursor' : color, ch, x, top)) continue;

      // Outside the atlas — a box-drawing character we did not pre-render, or
      // an emoji in a log. Slower, but a missing glyph would be worse.
      this.ctx.fillStyle = onCursor ? this.palette.background : this.palette[color];
      this.ctx.fillText(ch, x, top);
    }
  }
}

/**
 * Flatten a row's spans into one colour per character.
 *
 * Returns undefined for the overwhelmingly common uncoloured row, so the draw
 * loop allocates nothing for ordinary output. Later spans win over earlier
 * ones where they overlap, which is what makes a specific rule able to sit on
 * top of a general one.
 */
function colorRuns(row: Row): LineKind[] | undefined {
  if (row.spans === undefined || row.spans.length === 0) return undefined;

  const colors = new Array<LineKind>(row.text.length).fill(row.kind);
  for (const span of row.spans) {
    const from = Math.max(0, span.start);
    const to = Math.min(row.text.length, span.end);
    for (let i = from; i < to; i++) colors[i] = span.kind;
  }
  return colors;
}
