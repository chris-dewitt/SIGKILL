/**
 * The text being edited, and every way to change it.
 *
 * Deliberately knows nothing about vi, nano, keys or screens: it is lines, a
 * cursor, and an undo stack. Both front ends drive this, which is why `dd` in
 * vi and `^K` in nano cannot disagree about what deleting a line means.
 *
 * Lines never contain a newline. A file's trailing newline is a property of
 * serialising, not of the buffer -- see `toText`.
 */
export interface Cursor {
  /** 0-based line index. */
  line: number;
  /** 0-based column. May sit one past the last character while inserting. */
  col: number;
}

interface Snapshot {
  lines: string[];
  cursor: Cursor;
}

export class TextBuffer {
  private lines: string[];
  private cursorLine = 0;
  private cursorCol = 0;
  private undoStack: Snapshot[] = [];
  private redoStack: Snapshot[] = [];
  /** Set by any edit, cleared by a write. Drives vi's "No write since..." */
  dirty = false;

  /**
   * Column the cursor wants to be in while moving vertically.
   *
   * Real editors remember this: go to the end of a long line, down onto a
   * short one and back down onto a long one, and you land at the end again
   * rather than where the short line forced you.
   */
  private desiredCol = 0;

  constructor(text = '') {
    // A trailing newline is the normal shape of a text file and must not
    // become a phantom empty last line that the player then tries to delete.
    const body = text.endsWith('\n') ? text.slice(0, -1) : text;
    this.lines = body.length === 0 && text.length === 0 ? [''] : body.split('\n');
    if (this.lines.length === 0) this.lines = [''];
  }

  get cursor(): Cursor {
    return { line: this.cursorLine, col: this.cursorCol };
  }

  get count(): number {
    return this.lines.length;
  }

  /** Was this file empty of everything but a single blank line? */
  get isEmpty(): boolean {
    return this.lines.length === 1 && this.lines[0] === '';
  }

  line(index: number): string {
    return this.lines[index] ?? '';
  }

  all(): readonly string[] {
    return this.lines;
  }

  /** Serialise for writing. Always newline-terminated, like every Unix tool. */
  toText(): string {
    if (this.isEmpty) return '';
    return this.lines.join('\n') + '\n';
  }

  // ------------------------------------------------------------------ undo

  private checkpoint(): void {
    this.undoStack.push({ lines: [...this.lines], cursor: this.cursor });
    // An edit invalidates any redo, exactly as in a real editor.
    this.redoStack = [];
    // Bounded so a long session cannot grow without limit on a phone.
    if (this.undoStack.length > 200) this.undoStack.shift();
  }

  undo(): boolean {
    const previous = this.undoStack.pop();
    if (!previous) return false;
    this.redoStack.push({ lines: [...this.lines], cursor: this.cursor });
    this.lines = previous.lines;
    this.moveTo(previous.cursor.line, previous.cursor.col);
    this.dirty = true;
    return true;
  }

  redo(): boolean {
    const next = this.redoStack.pop();
    if (!next) return false;
    this.undoStack.push({ lines: [...this.lines], cursor: this.cursor });
    this.lines = next.lines;
    this.moveTo(next.cursor.line, next.cursor.col);
    this.dirty = true;
    return true;
  }

  // -------------------------------------------------------------- movement

  /**
   * Clamp and place the cursor.
   *
   * `allowPastEnd` is the difference between normal mode, where the cursor sits
   * *on* a character, and insert mode, where it sits *between* them and may
   * rest one past the last.
   */
  moveTo(line: number, col: number, allowPastEnd = false): void {
    this.cursorLine = Math.min(Math.max(0, line), this.lines.length - 1);
    const length = this.line(this.cursorLine).length;
    const max = allowPastEnd ? length : Math.max(0, length - 1);
    this.cursorCol = Math.min(Math.max(0, col), max);
    this.desiredCol = this.cursorCol;
  }

  /** Vertical movement, which remembers the column it was aiming for. */
  moveLine(delta: number, allowPastEnd = false): void {
    const wanted = Math.max(this.desiredCol, this.cursorCol);
    this.cursorLine = Math.min(Math.max(0, this.cursorLine + delta), this.lines.length - 1);
    const length = this.line(this.cursorLine).length;
    const max = allowPastEnd ? length : Math.max(0, length - 1);
    this.cursorCol = Math.min(wanted, max);
    this.desiredCol = wanted;
  }

  moveCol(delta: number, allowPastEnd = false): void {
    this.moveTo(this.cursorLine, this.cursorCol + delta, allowPastEnd);
  }

  lineStart(): void {
    this.moveTo(this.cursorLine, 0);
  }

  /** First non-blank character, which is what `^` means and what `I` uses. */
  firstNonBlank(): void {
    const text = this.line(this.cursorLine);
    const index = text.search(/\S/);
    this.moveTo(this.cursorLine, index < 0 ? 0 : index);
  }

  lineEnd(allowPastEnd = false): void {
    this.moveTo(this.cursorLine, this.line(this.cursorLine).length, allowPastEnd);
    // `$` sticks to the end through vertical movement, like the real thing.
    this.desiredCol = Number.MAX_SAFE_INTEGER;
  }

  /** Start of the next word, wrapping onto following lines. */
  wordForward(): void {
    let { line, col } = this.cursor;
    const isWord = (c: string): boolean => /\w/.test(c);
    const text = () => this.line(line);

    const onWord = isWord(text()[col] ?? '');
    // Leave the current run...
    while (col < text().length && isWord(text()[col] ?? '') === onWord && (text()[col] ?? '') !== ' ') col++;
    // ...then skip the whitespace before the next one.
    while (col >= text().length || /\s/.test(text()[col] ?? '')) {
      if (col >= text().length) {
        if (line >= this.lines.length - 1) {
          this.moveTo(line, Math.max(0, text().length - 1));
          return;
        }
        line++;
        col = 0;
        // An empty line is a word destination in vi, which surprises people
        // until they need it for navigating code.
        if (text().length === 0) break;
      } else {
        col++;
      }
    }
    this.moveTo(line, col);
  }

  wordBack(): void {
    let { line, col } = this.cursor;
    const text = () => this.line(line);
    col--;
    while (col < 0 || /\s/.test(text()[col] ?? '')) {
      if (col < 0) {
        if (line === 0) {
          this.moveTo(0, 0);
          return;
        }
        line--;
        col = Math.max(0, text().length - 1);
        if (text().length === 0) break;
      } else {
        col--;
      }
    }
    while (col > 0 && /\w/.test(text()[col - 1] ?? '')) col--;
    this.moveTo(line, Math.max(0, col));
  }

  // ----------------------------------------------------------------- edits

  insert(text: string): void {
    this.checkpoint();
    this.applyInsert(text);
  }

  /**
   * Record an undo point without changing anything.
   *
   * vi's insert mode needs this: one checkpoint at `i` so the whole session
   * undoes as a unit, but pressing `i` and immediately Escaping has to leave
   * the file as clean as it found it.
   */
  checkpointOnly(): void {
    this.checkpoint();
  }

  /** Insert without a checkpoint, so a whole insert session undoes as one. */
  insertContinuing(text: string): void {
    this.applyInsert(text);
  }

  private applyInsert(text: string): void {
    for (const ch of text) {
      const current = this.line(this.cursorLine);
      if (ch === '\n') {
        const before = current.slice(0, this.cursorCol);
        const after = current.slice(this.cursorCol);
        this.lines.splice(this.cursorLine, 1, before, after);
        this.cursorLine++;
        this.cursorCol = 0;
      } else {
        this.lines[this.cursorLine] = current.slice(0, this.cursorCol) + ch + current.slice(this.cursorCol);
        this.cursorCol++;
      }
    }
    this.desiredCol = this.cursorCol;
    if (text.length > 0) this.dirty = true;
  }

  /** Backspace. Joins onto the previous line at column zero, as expected. */
  deleteBack(): boolean {
    const current = this.line(this.cursorLine);
    if (this.cursorCol > 0) {
      this.lines[this.cursorLine] =
        current.slice(0, this.cursorCol - 1) + current.slice(this.cursorCol);
      this.cursorCol--;
    } else if (this.cursorLine > 0) {
      const previous = this.line(this.cursorLine - 1);
      this.lines.splice(this.cursorLine - 1, 2, previous + current);
      this.cursorLine--;
      this.cursorCol = previous.length;
    } else {
      return false;
    }
    this.desiredCol = this.cursorCol;
    this.dirty = true;
    return true;
  }

  /** Delete the character under the cursor — vi's `x`. */
  deleteChar(): void {
    const current = this.line(this.cursorLine);
    if (current.length === 0) return;
    this.checkpoint();
    this.lines[this.cursorLine] = current.slice(0, this.cursorCol) + current.slice(this.cursorCol + 1);
    this.moveTo(this.cursorLine, this.cursorCol);
    this.dirty = true;
  }

  /** Delete whole lines. Returns what was removed, for the yank register. */
  deleteLines(count = 1): string[] {
    this.checkpoint();
    const removed = this.lines.splice(this.cursorLine, count);
    // Deleting everything leaves one empty line, never zero: a buffer with no
    // lines has nowhere to put the cursor.
    if (this.lines.length === 0) this.lines = [''];
    this.moveTo(Math.min(this.cursorLine, this.lines.length - 1), 0);
    this.dirty = true;
    return removed;
  }

  /** Delete from the cursor to the end of the line — vi's `D`. */
  deleteToEnd(): string {
    this.checkpoint();
    const current = this.line(this.cursorLine);
    const removed = current.slice(this.cursorCol);
    this.lines[this.cursorLine] = current.slice(0, this.cursorCol);
    this.moveTo(this.cursorLine, this.cursorCol);
    this.dirty = true;
    return removed;
  }

  /** Delete forward one word — vi's `dw`. */
  deleteWord(): string {
    this.checkpoint();
    const current = this.line(this.cursorLine);
    const rest = current.slice(this.cursorCol);
    // The run of word characters, or of punctuation, plus trailing spaces.
    const match = /^(\w+|[^\w\s]+)?\s*/.exec(rest);
    const width = Math.max(1, match?.[0]?.length ?? 1);
    const removed = rest.slice(0, width);
    this.lines[this.cursorLine] = current.slice(0, this.cursorCol) + rest.slice(width);
    this.moveTo(this.cursorLine, this.cursorCol);
    this.dirty = true;
    return removed;
  }

  /** Replace the character under the cursor — vi's `r`. */
  replaceChar(ch: string): void {
    const current = this.line(this.cursorLine);
    if (current.length === 0) return;
    this.checkpoint();
    this.lines[this.cursorLine] =
      current.slice(0, this.cursorCol) + ch + current.slice(this.cursorCol + 1);
    this.dirty = true;
  }

  /** Open a blank line and put the cursor on it — vi's `o` and `O`. */
  openLine(below: boolean): void {
    this.checkpoint();
    const at = below ? this.cursorLine + 1 : this.cursorLine;
    this.lines.splice(at, 0, '');
    this.cursorLine = at;
    this.cursorCol = 0;
    this.desiredCol = 0;
    this.dirty = true;
  }

  /** Paste whole lines below or above the cursor — vi's `p` and `P`. */
  putLines(lines: readonly string[], below: boolean): void {
    if (lines.length === 0) return;
    this.checkpoint();
    const at = below ? this.cursorLine + 1 : this.cursorLine;
    this.lines.splice(at, 0, ...lines);
    this.moveTo(at, 0);
    this.dirty = true;
  }

  /** Join this line with the next — vi's `J`. */
  joinLine(): void {
    if (this.cursorLine >= this.lines.length - 1) return;
    this.checkpoint();
    const current = this.line(this.cursorLine);
    const next = this.line(this.cursorLine + 1).replace(/^\s+/, '');
    // vi puts a space at the seam unless there already is one.
    const glue = current.endsWith(' ') || current.length === 0 ? '' : ' ';
    this.lines.splice(this.cursorLine, 2, current + glue + next);
    this.moveTo(this.cursorLine, current.length);
    this.dirty = true;
  }

  /**
   * Substitute across a line range — the engine behind `:%s/a/b/g`.
   *
   * Returns the number of lines changed, which is what ex reports.
   */
  substitute(pattern: RegExp, replacement: string, from = 0, to = this.lines.length - 1): number {
    this.checkpoint();
    let changed = 0;
    for (let i = Math.max(0, from); i <= Math.min(to, this.lines.length - 1); i++) {
      const before = this.line(i);
      const after = before.replace(pattern, replacement);
      if (after !== before) {
        this.lines[i] = after;
        changed++;
      }
    }
    if (changed === 0) this.undoStack.pop();
    else this.dirty = true;
    return changed;
  }

  /** Search forward from just after the cursor, wrapping once. */
  search(pattern: RegExp, backwards = false): boolean {
    const total = this.lines.length;
    for (let step = 1; step <= total; step++) {
      const i = ((backwards ? this.cursorLine - step : this.cursorLine + step) % total + total) % total;
      const index = this.line(i).search(pattern);
      if (index >= 0) {
        this.moveTo(i, index);
        return true;
      }
    }
    // The cursor's own line last, so a match on it is found but not preferred.
    const here = this.line(this.cursorLine).search(pattern);
    if (here >= 0) {
      this.moveTo(this.cursorLine, here);
      return true;
    }
    return false;
  }

  markClean(): void {
    this.dirty = false;
  }
}
