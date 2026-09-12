import { atlasCodepoints, atlasColumns, slotPosition, type CellSize } from './metrics.js';

export interface AtlasOptions {
  /** CSS font shorthand, e.g. `13px "IBM Plex Mono", monospace`. */
  font: string;
  /** Device-pixel scale the atlas is rasterised at. */
  scale: number;
  /** One tinted atlas is built per entry. Keys are used by the renderer. */
  colors: Record<string, string>;
}

/**
 * Pre-rasterised glyphs.
 *
 * Drawing text with `fillText` once per cell is the slow path: at 50×44 cells
 * that is 2,200 shaping operations a frame. Rasterising each glyph once and
 * blitting it turns the hot loop into `drawImage`, which is what makes a
 * full-screen redraw affordable on a phone.
 *
 * Colour is baked in rather than tinted at draw time, because Canvas2D has no
 * cheap tint. The palette is four entries, the atlas is small, and four
 * copies cost less than one composite pass per frame.
 */
export class GlyphAtlas {
  readonly cell: CellSize;
  readonly scale: number;
  private readonly sheets = new Map<string, HTMLCanvasElement>();
  private readonly slots = new Map<number, number>();
  private readonly columns: number;

  constructor(opts: AtlasOptions) {
    this.scale = opts.scale;

    const points = atlasCodepoints();
    this.columns = atlasColumns(points.length);
    for (const [index, point] of points.entries()) this.slots.set(point, index);

    this.cell = measureCell(opts.font);

    const rows = Math.ceil(points.length / this.columns);
    const cellW = Math.ceil(this.cell.width * this.scale);
    const cellH = Math.ceil(this.cell.height * this.scale);

    for (const [name, color] of Object.entries(opts.colors)) {
      const sheet = document.createElement('canvas');
      sheet.width = this.columns * cellW;
      sheet.height = rows * cellH;

      const ctx = sheet.getContext('2d');
      if (!ctx) throw new Error('GlyphAtlas: 2d context unavailable');

      ctx.font = scaleFont(opts.font, this.scale);
      ctx.textBaseline = 'alphabetic';
      ctx.fillStyle = color;

      // Sit the baseline where a monospace font expects it. Eyeballing this
      // is what makes descenders clip, so it comes from the metrics.
      const metrics = ctx.measureText('M');
      const ascent = metrics.actualBoundingBoxAscent || this.cell.height * this.scale * 0.75;
      const baseline = Math.round((cellH + ascent) / 2);

      for (const [index, point] of points.entries()) {
        const { col, row } = slotPosition(index, this.columns);
        ctx.fillText(String.fromCodePoint(point), col * cellW, row * cellH + baseline);
      }

      this.sheets.set(name, sheet);
    }
  }

  has(codepoint: number): boolean {
    return this.slots.has(codepoint);
  }

  /**
   * Blit one character.
   *
   * Returns false for a codepoint the atlas does not carry, so the caller can
   * fall back to `fillText` — slower, but never a missing glyph.
   */
  draw(
    ctx: CanvasRenderingContext2D,
    color: string,
    ch: string,
    x: number,
    y: number,
  ): boolean {
    const point = ch.codePointAt(0);
    if (point === undefined) return true;

    const index = this.slots.get(point);
    const sheet = this.sheets.get(color);
    if (index === undefined || !sheet) return false;

    const cellW = Math.ceil(this.cell.width * this.scale);
    const cellH = Math.ceil(this.cell.height * this.scale);
    const { col, row } = slotPosition(index, this.columns);

    ctx.drawImage(
      sheet,
      col * cellW, row * cellH, cellW, cellH,
      x, y, cellW, cellH,
    );
    return true;
  }
}

/** Scale the size in a CSS font shorthand, leaving family and weight alone. */
export function scaleFont(font: string, scale: number): string {
  return font.replace(/(\d+(?:\.\d+)?)px/, (_m, size: string) => `${Number(size) * scale}px`);
}

/**
 * Measure one monospace cell.
 *
 * Width comes from a run of characters divided by their count rather than a
 * single glyph, because a single `measureText` rounds and the error
 * accumulates across fifty columns into a visible drift.
 */
export function measureCell(font: string): CellSize {
  const probe = document.createElement('canvas');
  const ctx = probe.getContext('2d');
  if (!ctx) return { width: 8, height: 16 };

  ctx.font = font;
  const sample = 'MMMMMMMMMMMMMMMMMMMM';
  const width = ctx.measureText(sample).width / sample.length;

  const metrics = ctx.measureText('Mgjpq|');
  const ascent = metrics.actualBoundingBoxAscent || 0;
  const descent = metrics.actualBoundingBoxDescent || 0;
  const measured = ascent + descent;

  // Line height, not glyph height: a terminal needs the leading or rows touch.
  const size = Number(/(\d+(?:\.\d+)?)px/.exec(font)?.[1] ?? 13);
  const height = Math.max(measured * 1.18, size * 1.5);

  return { width, height };
}
