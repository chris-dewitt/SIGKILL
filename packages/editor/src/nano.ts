import { TextBuffer } from './buffer.js';
import type { EditorExit, EditorKey, EditorOptions, FrameLine, FullscreenProgram } from './types.js';

/**
 * nano.
 *
 * Exists because modal editing is a bad first lesson. A Cadet who has never
 * opened an editor should be able to type, see the letters appear, and read
 * how to save off the bottom of the screen -- which is exactly nano's whole
 * design and why it ships as the default editor on most systems now.
 *
 * The shortcut bar is not decoration: it is the reason nobody has ever been
 * trapped in nano the way everybody has been trapped in vi.
 */
export class NanoEditor implements FullscreenProgram {
  readonly name = 'nano';

  private buffer: TextBuffer;
  private rows: number;
  private cols: number;
  readonly path: string;
  readonly user: { uid: number; gid: number; name: string };
  private readonly readOnly: boolean;
  private top = 0;
  private message: string;
  private status: 'info' | 'error' = 'info';
  /** Set by ^X on a modified file: the y/n/^C prompt. */
  private confirming = false;
  private finished: EditorExit | null = null;
  pendingWrite: string | undefined;

  constructor(text: string, opts: EditorOptions) {
    this.buffer = new TextBuffer(text);
    this.rows = Math.max(4, opts.rows);
    this.cols = Math.max(20, opts.cols);
    this.path = opts.path;
    this.user = opts.user ?? { uid: 0, gid: 0, name: 'root' };
    this.readOnly = opts.readOnly ?? false;
    this.message = opts.isNew
      ? '[ New File ]'
      : this.readOnly
        ? '[ Read only -- saving needs sudo ]'
        : '';
  }

  get exit(): EditorExit | null {
    return this.finished;
  }

  /** The host reporting back, usually a write the disk refused. */
  notify(message: string): void {
    this.message = message;
    this.status = 'error';
    this.buffer.dirty = true;
  }

  resize(rows: number, cols: number): void {
    this.rows = Math.max(4, rows);
    this.cols = Math.max(20, cols);
  }

  get chips(): readonly string[] {
    if (this.confirming) return ['Y', 'N', '^C'];
    return ['^O', '^X', '^K', '^U', '←', '→', '↑', '↓'];
  }

  key(k: EditorKey): void {
    if (this.finished) return;

    if (this.confirming) return this.confirmKey(k);

    if (k.ctrl) return this.controlKey(k.key.toLowerCase());

    switch (k.key) {
      case 'Escape': this.message = ''; return;
      case 'Enter': this.edit(() => this.buffer.insertContinuing('\n')); return;
      case 'Backspace': this.edit(() => this.buffer.deleteBack()); return;
      case 'Tab': this.edit(() => this.buffer.insertContinuing('  ')); return;
      case 'ArrowLeft': this.buffer.moveCol(-1, true); return;
      case 'ArrowRight': this.buffer.moveCol(1, true); return;
      case 'ArrowUp': this.buffer.moveLine(-1, true); return;
      case 'ArrowDown': this.buffer.moveLine(1, true); return;
      case 'Home': this.buffer.lineStart(); return;
      case 'End': this.buffer.lineEnd(true); return;
      default:
        if (k.key.length === 1) this.edit(() => this.buffer.insertContinuing(k.key));
    }
  }

  private controlKey(key: string): void {
    switch (key) {
      case 'o': return this.save();
      case 'x': return this.quit();
      case 'k': this.edit(() => { this.buffer.deleteLines(1); }); return;
      case 'u': this.edit(() => this.buffer.putLines([''], false)); return;
      case 'a': this.buffer.lineStart(); return;
      case 'e': this.buffer.lineEnd(true); return;
      case 'c':
        this.message = `line ${this.buffer.cursor.line + 1}/${this.buffer.count}, col ${this.buffer.cursor.col + 1}`;
        this.status = 'info';
        return;
      case 'g':
        this.message = '^O write out   ^X exit   ^K cut line   ^A start of line   ^E end of line';
        this.status = 'info';
        return;
      default:
        this.message = `Unknown command: ^${key.toUpperCase()}`;
        this.status = 'error';
    }
  }

  /**
   * Apply a change.
   *
   * A read-only file is still editable here, as it is in nano and vi: the
   * refusal belongs at the save, not at the keystroke. Blocking typing reads
   * as a broken editor and tells the player nothing about why.
   */
  private edit(change: () => void): void {
    change();
    this.message = '';
  }

  private save(): void {
    const text = this.buffer.toText();
    this.pendingWrite = text;
    this.buffer.markClean();
    this.message = `[ Wrote ${this.buffer.count} line${this.buffer.count === 1 ? '' : 's'} ]`;
    this.status = 'info';
  }

  private quit(): void {
    if (!this.buffer.dirty) {
      this.finished = { write: false, text: this.buffer.toText() };
      return;
    }
    this.confirming = true;
    this.message = 'Save modified buffer?  Y Yes   N No   ^C Cancel';
    this.status = 'info';
  }

  private confirmKey(k: EditorKey): void {
    const key = k.key.toLowerCase();
    if (k.ctrl && key === 'c') {
      this.confirming = false;
      this.message = 'Cancelled';
      return;
    }
    if (key === 'y') {
      // The write is attempted even on a read-only file; the filesystem is
      // what refuses, and it says why.
      this.finished = { write: true, text: this.buffer.toText(), message: `Wrote ${this.path}` };
      return;
    }
    if (key === 'n') {
      this.finished = { write: false, text: this.buffer.toText() };
      return;
    }
    // Anything else leaves the prompt up rather than guessing.
  }

  frame(): FrameLine[] {
    // Title, text, message, two shortcut rows.
    const chrome = 4;
    const textRows = Math.max(1, this.rows - chrome);
    this.scrollIntoView(textRows);

    const lines: FrameLine[] = [{ text: this.titleLine(), kind: 'echo' }];

    const cursor = this.buffer.cursor;
    for (let i = 0; i < textRows; i++) {
      const index = this.top + i;
      if (index >= this.buffer.count) {
        lines.push({ text: '', kind: 'out' });
        continue;
      }
      const row: FrameLine = { text: this.buffer.line(index), kind: 'out' };
      if (index === cursor.line) row.cursor = cursor.col;
      lines.push(row);
    }

    lines.push({ text: this.message.slice(0, this.cols), kind: this.status === 'error' ? 'err' : 'system' });
    lines.push({ text: '^O Write Out   ^K Cut Line    ^A Start of line   ^G Help', kind: 'system' });
    lines.push({ text: '^X Exit        ^U Paste       ^E End of line     ^C Where am I', kind: 'system' });
    return lines;
  }

  /**
   * nano's three-part title: name, file, modified flag.
   *
   * Built as three pieces rather than one centred string because at phone
   * width a single slice cuts the right-hand end off -- and the right-hand end
   * is the "Modified" flag, which is the one part of the line that changes and
   * the only part the player needs.
   */
  private titleLine(): string {
    const name = 'nano';
    const flag = this.buffer.dirty ? 'Modified' : '';
    // What is left for the path once both ends are guaranteed their room.
    const room = Math.max(4, this.cols - name.length - flag.length - 4);
    const path = this.path.length <= room ? this.path : '...' + this.path.slice(-(room - 3));

    const left = `${name}  ${path}`;
    const gap = Math.max(2, this.cols - left.length - flag.length);
    return (left + ' '.repeat(gap) + flag).slice(0, this.cols);
  }

  private scrollIntoView(textRows: number): void {
    const line = this.buffer.cursor.line;
    if (line < this.top) this.top = line;
    else if (line >= this.top + textRows) this.top = line - textRows + 1;
    this.top = Math.max(0, this.top);
  }

  get text(): string {
    return this.buffer.toText();
  }
}
