import { GlyphAtlas, scaleFont } from './atlas.js';
import type { Row, TerminalBuffer } from './buffer.js';
import { backingSize, gridFor, visibleRange, type GridSize } from './metrics.js';

export interface Palette {
  background: string;
  out: string;
  err: string;
  echo: string;
  system: string;
}

export const PHOSPHOR: Palette = {
  background: '#050806',
  out: '#6ee7a0',
  err: '#e0705a',
  echo: '#c8f7dd',
  system: '#3e7f5c',
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
    return {
      out: this.palette.out,
      err: this.palette.err,
      echo: this.palette.echo,
      system: this.palette.system,
      cursor: this.palette.background,
    };
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
    // The atlas is keyed by line kind, so the kind *is* the colour key.
    const color = row.kind;

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

      const x = left + n * cellW;
      if (this.atlas.draw(this.ctx, onCursor ? 'cursor' : color, ch, x, top)) continue;

      // Outside the atlas — a box-drawing character we did not pre-render, or
      // an emoji in a log. Slower, but a missing glyph would be worse.
      this.ctx.fillStyle = onCursor ? this.palette.background : this.palette[row.kind];
      this.ctx.fillText(ch, x, top);
    }
  }
}
