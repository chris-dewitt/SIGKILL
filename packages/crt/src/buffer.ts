/**
 * What a line is for. The renderer maps these to colours; the Machine never
 * emits them, because the Machine has no screen.
 */
export type LineKind = 'out' | 'err' | 'echo' | 'system';

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
    this.lines.push(cursor === undefined ? { text, kind } : { text, kind, cursor });
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
      for (const [n, chunk] of wrap(line.text, cols).entries()) {
        const row: Row = { text: chunk, kind: line.kind, line: index, first: n === 0 };
        if (line.cursor !== undefined && n === 0) row.cursor = line.cursor;
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

/** Wrap one string to a width, preferring word boundaries. */
export function wrap(text: string, cols: number): string[] {
  if (cols < 1) return [];
  if (text.length <= cols) return [text];

  const out: string[] = [];
  let rest = text;

  while (rest.length > cols) {
    const window = rest.slice(0, cols + 1);
    let cut = window.lastIndexOf(' ');

    // No space to break on, or the break would emit an empty row: hard-break.
    if (cut <= 0) cut = cols;

    out.push(rest.slice(0, cut).trimEnd());
    rest = rest.slice(cut).replace(/^ +/, '');

    // A line of nothing but spaces would otherwise loop forever.
    if (rest.length === 0) return out;
  }

  out.push(rest);
  return out;
}
