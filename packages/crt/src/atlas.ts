import { faceFont } from './faces.js';
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
 * cheap tint -- one sheet per colour. With a four-colour palette that was free.
 * With a dozen it would not be: each sheet is roughly 700 KB of canvas at 2×,
 * so building them all up front would hand a phone eight megabytes, most of it
 * for accents that a given screenful never uses.
 *
 * So sheets are built on first use and kept. An adventure that never prints a
 * warning never pays for the warning colour, and one that uses everything pays
 * exactly once, spread across the frames where each colour first appears.
 */
export class GlyphAtlas {
  readonly cell: CellSize;
  readonly scale: number;
  private readonly sheets = new Map<string, HTMLCanvasElement>();
  private readonly colors: Record<string, string>;
  private readonly font: string;
  private readonly slots = new Map<number, number>();
  private readonly columns: number;
  private readonly points: number[];

  constructor(opts: AtlasOptions) {
    this.scale = opts.scale;
    this.colors = { ...opts.colors };
    this.font = opts.font;

    this.points = atlasCodepoints();
    this.columns = atlasColumns(this.points.length);
    for (const [index, point] of this.points.entries()) this.slots.set(point, index);

    this.cell = measureCell(opts.font);
  }

  /** Rasterise one colour's sheet, or return the one already built. */
  private sheet(name: string): HTMLCanvasElement | undefined {
    const existing = this.sheets.get(name);
    if (existing) return existing;

    const color = this.colors[name];
    if (color === undefined) return undefined;

    const rows = Math.ceil(this.points.length / this.columns);
    const cellW = Math.ceil(this.cell.width * this.scale);
    const cellH = Math.ceil(this.cell.height * this.scale);

    const sheet = document.createElement('canvas');
    sheet.width = this.columns * cellW;
    sheet.height = rows * cellH;

    const ctx = sheet.getContext('2d');
    if (!ctx) throw new Error('GlyphAtlas: 2d context unavailable');

    ctx.font = scaleFont(faceFont(this.font, name), this.scale);
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = color;

    // Sit the baseline where a monospace font expects it. Eyeballing this
    // is what makes descenders clip, so it comes from the metrics.
    const metrics = ctx.measureText('M');
    const ascent = metrics.actualBoundingBoxAscent || this.cell.height * this.scale * 0.75;
    const baseline = Math.round((cellH + ascent) / 2);

    for (const [index, point] of this.points.entries()) {
      const { col, row } = slotPosition(index, this.columns);
      ctx.fillText(String.fromCodePoint(point), col * cellW, row * cellH + baseline);
    }

    this.sheets.set(name, sheet);
    return sheet;
  }

  /** How many sheets have actually been rasterised. For tests and budgeting. */
  get built(): number {
    return this.sheets.size;
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
    const sheet = this.sheet(color);
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
