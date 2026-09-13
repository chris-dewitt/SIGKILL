/**
 * What a line, or a run inside one, is for.
 *
 * Every name is a *meaning* and never a hue, so the palette can be retuned
 * without touching a single call site. The renderer maps these to colours; the
 * Machine never emits them, because the Machine has no screen.
 *
 * This list is the source of truth: `Palette` is required to cover it, so
 * adding a kind without giving it a colour will not compile.
 */
export const LINE_KINDS = [
  /** Ordinary command output. */
  'out',
  /** Something went wrong. */
  'err',
  /** The line the player typed, echoed back. */
  'echo',
  /** The adventure speaking, rather than the machine. */
  'system',
  /** The `ORACLE:` prefix itself, so the name recedes and the words carry. */
  'speaker',
  /** A command the player could type right now. */
  'command',
  /** A path or filename. */
  'path',
  /** A number that matters: a target, a reading, a count. */
  'value',
  /** A title, a rule, the frame of a box. */
  'heading',
  /** Done, running, sealed, healthy. */
  'good',
  /** Worth your attention, not yet an error. */
  'warn',
  /** Present but deliberately quiet. */
  'muted',
] as const;

export type LineKind = (typeof LINE_KINDS)[number];

/**
 * A coloured run inside a line.
 *
 * Offsets are into the line's own text, so a span survives the line being
 * rewrapped at a different width -- which is the whole reason the buffer
 * stores unwrapped text in the first place.
 */
export interface Span {
  /** First character of the run. */
  start: number;
  /** One past the last. */
  end: number;
  kind: LineKind;
}

/** A line as written. Unwrapped — wrapping is a function of width. */
export interface Line {
  text: string;
  kind: LineKind;
  /**
   * Column to draw a block cursor on.
   *
   * Only full-screen programs set this, and they are handed the real column
   * count and truncate to it, so a line carrying a cursor never wraps. That
   * is what makes the mapping below exact.
   */
  cursor?: number;
  /**
   * Never reflow this line: clip it to the width instead.
   *
   * For art. Wrapping prose is a kindness and wrapping a picture is vandalism
   * -- `wrap` breaks on spaces and trims the trailing ones, which are exactly
   * the spaces holding a drawing's columns in line. A clipped drawing is a
   * drawing with its right edge missing, which a player can read; a wrapped
   * one is confetti.
   */
  nowrap?: boolean;
  /**
   * Coloured runs within the line.
   *
   * Everything not covered by a span is drawn in the line's own `kind`. This
   * is what lets one sentence of ORACLE's carry a command in cyan and a path
   * in periwinkle without the author splitting it into three lines.
   */
  spans?: readonly Span[];
}

/** One row as displayed, after wrapping to a given width. */
export interface Row {
  text: string;
  kind: LineKind;
  /** Index of the logical line this row came from. */
  line: number;
  /** True for the first row of a wrapped line, for continuation markers. */
  first: boolean;
  /** Column within this row to draw the block cursor on. */
  cursor?: number;
  /** Coloured runs, with offsets rebased onto this row. */
  spans?: readonly Span[];
}

export interface BufferOptions {
  /** Logical lines kept before the oldest is dropped. */
  scrollback?: number;
}

const DEFAULT_SCROLLBACK = 2000;

/**
 * The terminal's contents.
 *
 * Logical lines are stored unwrapped and wrapping is computed on demand. That
 * is the whole reason this is a separate object from the renderer: rotating a
 * phone, opening the keyboard, or changing the font size all change the
 * column count, and a buffer that stored pre-wrapped rows would reflow wrong
 * every time. Real terminals fight this problem for years; storing the
 * unwrapped truth avoids it entirely.
 *
 * It also means the accessibility mirror has something honest to read: the
 * lines as written, not as broken across a 34-column phone screen.
 */
export class TerminalBuffer {
  private lines: Line[] = [];
  private readonly scrollback: number;
  /** Bumped on every mutation so the renderer can skip identical frames. */
  private generation = 0;

  constructor(opts: BufferOptions = {}) {
    this.scrollback = opts.scrollback ?? DEFAULT_SCROLLBACK;
  }

  get revision(): number {
    return this.generation;
  }

  get length(): number {
    return this.lines.length;
  }

  /** Append one line. A trailing newline in `text` does not create a blank. */
  push(text: string, kind: LineKind = 'out', cursor?: number): void {
    this.pushLine(cursor === undefined ? { text, kind } : { text, kind, cursor });
  }

  /**
   * Append a line with every field spelled out.
   *
   * The flag-carrying path, for art and anything else that needs more than
   * text and a colour. `push` stays the short form because almost everything
   * is text and a colour.
   */
  pushLine(line: Line): void {
    this.lines.push(line);
    if (this.lines.length > this.scrollback) {
      this.lines.splice(0, this.lines.length - this.scrollback);
    }
    this.generation++;
  }

  /**
   * Append a block of output, splitting on newlines.
   *
   * A single trailing newline is dropped — `echo hi` produces "hi\n" and must
   * yield one line, not one line and a blank.
   */
  write(text: string, kind: LineKind = 'out'): void {
    if (text.length === 0) return;
    const parts = text.split('\n');
    if (parts[parts.length - 1] === '') parts.pop();
    for (const part of parts) this.push(part, kind);
  }

  /**
   * Append a block of art: every row clipped rather than wrapped.
   *
   * Rows are pushed exactly as given, trailing spaces and all, because in a
   * drawing a trailing space is a pixel.
   */
  writeArt(rows: readonly string[], kind: LineKind = 'out'): void {
    for (const row of rows) this.pushLine({ text: row, kind, nowrap: true });
  }

  clear(): void {
    this.lines = [];
    this.generation++;
  }

  /** The logical lines, for the accessibility mirror and for saving. */
  all(): readonly Line[] {
    return this.lines;
  }

  /**
   * Wrap to `cols` and return the visual rows.
   *
   * Breaks on the last space that fits, so words survive; falls back to a
   * hard break for a token longer than the line, which is what a long path
   * or a base64 blob is.
   */
  layout(cols: number): Row[] {
    if (cols < 1) return [];
    const rows: Row[] = [];

    for (const [index, line] of this.lines.entries()) {
      if (line.text.length === 0) {
        const blank: Row = { text: '', kind: line.kind, line: index, first: true };
        // A cursor on an empty line still has to be drawn, at column zero.
        if (line.cursor !== undefined) blank.cursor = line.cursor;
        rows.push(blank);
        continue;
      }
      if (line.nowrap === true) {
        // Clipped, not wrapped. See `Line.nowrap`.
        const text = line.text.slice(0, cols);
        const row: Row = { text, kind: line.kind, line: index, first: true };
        if (line.cursor !== undefined) row.cursor = line.cursor;
        const spans = spansFor(line.spans, 0, text.length);
        if (spans) row.spans = spans;
        rows.push(row);
        continue;
      }
      for (const [n, chunk] of wrapChunks(line.text, cols).entries()) {
        const row: Row = { text: chunk.text, kind: line.kind, line: index, first: n === 0 };
        if (line.cursor !== undefined && n === 0) row.cursor = line.cursor;
        const spans = spansFor(line.spans, chunk.start, chunk.text.length);
        if (spans) row.spans = spans;
        rows.push(row);
      }
    }

    return rows;
  }

  /** How many rows the content occupies at this width. */
  height(cols: number): number {
    return this.layout(cols).length;
  }
}

/** One wrapped row, and where it began in the original string. */
export interface Chunk {
  text: string;
  /** Offset of `text[0]` within the unwrapped line. */
  start: number;
}

/**
 * Wrap one string to a width, preferring word boundaries, reporting offsets.
 *
 * The offsets are what let coloured spans survive wrapping. Without them a
 * span would have to be re-found in each row by searching for its text, which
 * is both slower and wrong the moment the same word appears twice.
 */
export function wrapChunks(text: string, cols: number): Chunk[] {
  if (cols < 1) return [];
  if (text.length <= cols) return [{ text, start: 0 }];

  const out: Chunk[] = [];
  let rest = text;
  let consumed = 0;

  while (rest.length > cols) {
    const window = rest.slice(0, cols + 1);
    let cut = window.lastIndexOf(' ');

    // No space to break on, or the break would emit an empty row: hard-break.
    if (cut <= 0) cut = cols;

    // trimEnd only ever removes from the right, so the start offset stands.
    out.push({ text: rest.slice(0, cut).trimEnd(), start: consumed });

    const remainder = rest.slice(cut);
    const stripped = remainder.replace(/^ +/, '');
    consumed += cut + (remainder.length - stripped.length);
    rest = stripped;

    // A line of nothing but spaces would otherwise loop forever.
    if (rest.length === 0) return out;
  }

  out.push({ text: rest, start: consumed });
  return out;
}

/** Wrap one string to a width, preferring word boundaries. */
export function wrap(text: string, cols: number): string[] {
  return wrapChunks(text, cols).map((chunk) => chunk.text);
}

/**
 * Clip spans to one wrapped row and rebase them onto it.
 *
 * Returns undefined rather than an empty array when nothing lands here, so a
 * row with no colour carries no property at all.
 */
export function spansFor(
  spans: readonly Span[] | undefined,
  start: number,
  length: number,
): Span[] | undefined {
  if (spans === undefined || spans.length === 0) return undefined;
  const end = start + length;
  const out: Span[] = [];

  for (const span of spans) {
    const from = Math.max(span.start, start);
    const to = Math.min(span.end, end);
    if (to <= from) continue;
    out.push({ start: from - start, end: to - start, kind: span.kind });
  }

  return out.length > 0 ? out : undefined;
}
