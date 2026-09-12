import { TextBuffer } from './buffer.js';
import type { EditorExit, EditorKey, EditorOptions, FrameLine, FullscreenProgram } from './types.js';

type Mode = 'normal' | 'insert' | 'command';

/** What a pending operator or prefix is waiting for. */
type Pending = 'none' | 'd' | 'y' | 'g' | 'r' | 'Z';

/**
 * vi.
 *
 * A real subset, not a mock: modal editing, counts, operators, an undo stack,
 * ex commands and a status line. What it leaves out (visual mode, marks,
 * macros, registers beyond the unnamed one) it leaves out silently rather than
 * pretending, and `:help` inside it says so.
 *
 * Two deliberate departures from the real thing, both because this runs on a
 * phone as well as a keyboard:
 *
 *   - `chips` exposes the keys worth showing as buttons for the current mode,
 *     so Escape is always one tap away. Modal editing with no reachable Escape
 *     is the single reason vi on a touchscreen usually fails.
 *   - Tab inserts two spaces. Every file the player edits here is a config
 *     file where a literal tab would be a bug they could not see.
 */
export class ViEditor implements FullscreenProgram {
  readonly name = 'vi';

  private buffer: TextBuffer;
  private mode: Mode = 'normal';
  private pending: Pending = 'none';
  private countDigits = '';
  private commandLine = '';
  private message: string;
  private status: 'info' | 'error' = 'info';
  private rows: number;
  private cols: number;
  readonly path: string;
  readonly user: { uid: number; gid: number; name: string };
  private readonly readOnly: boolean;
  /** First buffer line shown, so the cursor can be kept on screen. */
  private top = 0;
  private showNumbers = false;
  private register: string[] = [];
  private lastSearch: RegExp | undefined;
  private finished: EditorExit | null = null;

  constructor(text: string, opts: EditorOptions) {
    this.buffer = new TextBuffer(text);
    this.rows = Math.max(3, opts.rows);
    this.cols = Math.max(20, opts.cols);
    this.path = opts.path;
    this.user = opts.user ?? { uid: 0, gid: 0, name: 'root' };
    this.readOnly = opts.readOnly ?? false;

    const lines = this.buffer.count;
    const chars = text.length;
    // The tail is the useful half of this line, so it is what survives a
    // narrow screen: the path is shortened until the flags fit, never the
    // other way round.
    const tail = opts.isNew
      ? '[New File]'
      : this.readOnly
        ? `[readonly] ${lines}L  :w! forces`
        : `${lines}L, ${chars}C`;
    this.message = `"${this.fitPath(this.cols - tail.length - 3)}" ${tail}`;
  }

  /**
   * The path, shortened to leave room for the rest of the status line.
   *
   * At phone width a full path eats the whole line and the flag that actually
   * matters -- [readonly], [+] -- gets sliced off the end.
   */
  private fitPath(budget = 24): string {
    if (budget < 8) budget = 8;
    if (this.path.length <= budget) return this.path;
    const base = this.path.slice(this.path.lastIndexOf('/') + 1);
    return base.length <= budget ? base : base.slice(0, budget - 1) + '…';
  }

  get exit(): EditorExit | null {
    return this.finished;
  }

  resize(rows: number, cols: number): void {
    this.rows = Math.max(3, rows);
    this.cols = Math.max(20, cols);
  }

  /** Keys worth putting on screen, by mode. Order is tap priority. */
  get chips(): readonly string[] {
    if (this.mode === 'insert') return ['ESC', '←', '→', '↑', '↓'];
    if (this.mode === 'command') return ['ESC', 'ENTER', '←', '→'];
    return ['i', 'ESC', ':w', ':wq', 'dd', 'u', 'x', 'o', '$', '0'];
  }

  // ------------------------------------------------------------------ input

  key(k: EditorKey): void {
    if (this.finished) return;
    if (this.mode === 'command') return this.commandKey(k);
    if (this.mode === 'insert') return this.insertKey(k);
    this.normalKey(k);
  }

  private get count(): number {
    return this.countDigits === '' ? 1 : Math.min(parseInt(this.countDigits, 10), 10_000);
  }

  private clearPending(): void {
    this.pending = 'none';
    this.countDigits = '';
  }

  private normalKey(k: EditorKey): void {
    const { key } = k;

    // Any keypress dismisses whatever the status line was saying, so the
    // ruler comes back. Handlers below that want to say something set it
    // again after this, and win.
    this.message = '';

    // Waiting on the character for `r`, which takes anything including a digit.
    if (this.pending === 'r') {
      if (key.length === 1) this.buffer.replaceChar(key);
      this.clearPending();
      return;
    }

    if (k.ctrl && (key === 'r' || key === 'R')) {
      this.note(this.buffer.redo() ? 'redo' : 'Already at newest change');
      this.clearPending();
      return;
    }

    // A count prefix. A leading 0 is the motion, not a digit.
    if (/^[0-9]$/.test(key) && !(key === '0' && this.countDigits === '')) {
      this.countDigits += key;
      return;
    }

    if (this.pending === 'g') {
      this.clearPending();
      if (key === 'g') this.buffer.moveTo(0, 0);
      return;
    }

    // ZZ: write and quit. However people first learn to leave vi, most of them
    // end up here.
    if (this.pending === 'Z') {
      this.clearPending();
      if (key === 'Z') this.write(true, false);
      else if (key === 'Q') this.finished = { write: false, text: this.buffer.toText() };
      return;
    }

    if (this.pending === 'd' || this.pending === 'y') {
      const operator = this.pending;
      const times = this.count;
      this.clearPending();
      if (key === operator) {
        // `dd` / `yy` — whole lines.
        if (operator === 'd') {
          this.register = this.buffer.deleteLines(times);
          this.note(times > 1 ? `${times} fewer lines` : '');
        } else {
          this.register = [];
          for (let i = 0; i < times; i++) this.register.push(this.buffer.line(this.buffer.cursor.line + i));
          this.note(times > 1 ? `${times} lines yanked` : '1 line yanked');
        }
        return;
      }
      if (key === 'w' && operator === 'd') {
        for (let i = 0; i < times; i++) this.buffer.deleteWord();
        return;
      }
      if (key === '$' && operator === 'd') {
        this.buffer.deleteToEnd();
        return;
      }
      // Any other motion after an operator is not supported; say nothing and
      // drop it, exactly as vi drops an unknown operator-motion pair.
      return;
    }

    switch (key) {
      // ------------------------------------------------------- movement
      case 'h': case 'ArrowLeft': this.buffer.moveCol(-this.count); break;
      case 'l': case 'ArrowRight': this.buffer.moveCol(this.count); break;
      case 'j': case 'ArrowDown': this.buffer.moveLine(this.count); break;
      case 'k': case 'ArrowUp': this.buffer.moveLine(-this.count); break;
      case '0': this.buffer.lineStart(); break;
      case '^': this.buffer.firstNonBlank(); break;
      case '$': this.buffer.lineEnd(); break;
      case 'w': for (let i = 0; i < this.count; i++) this.buffer.wordForward(); break;
      case 'b': for (let i = 0; i < this.count; i++) this.buffer.wordBack(); break;
      case 'g': this.pending = 'g'; return;
      case 'G':
        this.buffer.moveTo(this.countDigits === '' ? this.buffer.count - 1 : this.count - 1, 0);
        break;

      // ---------------------------------------------------------- edits
      case 'x': for (let i = 0; i < this.count; i++) this.buffer.deleteChar(); break;
      case 'D': this.buffer.deleteToEnd(); break;
      case 'J': this.buffer.joinLine(); break;
      case 'r': this.pending = 'r'; return;
      case 'd': this.pending = 'd'; return;
      case 'y': this.pending = 'y'; return;
      case 'p': this.buffer.putLines(this.register, true); break;
      case 'P': this.buffer.putLines(this.register, false); break;
      case 'u': this.note(this.buffer.undo() ? 'undo' : 'Already at oldest change'); break;

      // ------------------------------------------------ entering insert
      case 'i': this.enterInsert(); break;
      case 'a': this.buffer.moveCol(1, true); this.enterInsert(); break;
      case 'I': this.buffer.firstNonBlank(); this.enterInsert(); break;
      case 'A': this.buffer.lineEnd(true); this.enterInsert(); break;
      case 'o': this.buffer.openLine(true); this.enterInsert(); break;
      case 'O': this.buffer.openLine(false); this.enterInsert(); break;

      // ------------------------------------------------------- the rest
      case ':': this.mode = 'command'; this.commandLine = ':'; this.message = ''; break;
      case '/': this.mode = 'command'; this.commandLine = '/'; this.message = ''; break;
      case 'n': this.repeatSearch(false); break;
      case 'N': this.repeatSearch(true); break;
      case 'Z': this.pending = 'Z'; return;
      case 'Escape': this.message = ''; break;

      default:
        // Real vi beeps and moves on. This is a teaching game and the status
        // line is right there, so it says the one thing the player needs:
        // letters are commands until you ask for insert mode. Without this,
        // typing a word in normal mode looks exactly like a broken editor.
        if (key.length === 1 && key >= ' ') {
          this.note(`Not a command: ${key}   --   press i to start typing, or :help`);
        }
        break;
    }

    this.clearPending();
  }

  private enterInsert(): void {
    this.mode = 'insert';
    this.message = '';
    // One checkpoint for the whole session, so Escape then `u` undoes the
    // entire insert rather than one character at a time. Inserting nothing
    // must not mark the file changed -- otherwise `i` Escape `:q` refuses to
    // quit a file the player never touched.
    this.buffer.checkpointOnly();
  }

  private insertKey(k: EditorKey): void {
    const { key } = k;
    if (key === 'Escape') {
      this.mode = 'normal';
      // The cursor may be resting one past the end; normal mode cannot.
      this.buffer.moveCol(-1);
      this.message = '';
      return;
    }
    switch (key) {
      case 'Enter': this.buffer.insertContinuing('\n'); return;
      case 'Backspace': this.buffer.deleteBack(); return;
      case 'Tab': this.buffer.insertContinuing('  '); return;
      case 'ArrowLeft': this.buffer.moveCol(-1, true); return;
      case 'ArrowRight': this.buffer.moveCol(1, true); return;
      case 'ArrowUp': this.buffer.moveLine(-1, true); return;
      case 'ArrowDown': this.buffer.moveLine(1, true); return;
      default:
        if (key.length === 1) this.buffer.insertContinuing(key);
    }
  }

  private commandKey(k: EditorKey): void {
    const { key } = k;
    if (key === 'Escape') {
      this.mode = 'normal';
      this.commandLine = '';
      return;
    }
    if (key === 'Backspace') {
      this.commandLine = this.commandLine.slice(0, -1);
      // Backspacing away the `:` leaves command mode, as it does in vim.
      if (this.commandLine === '') this.mode = 'normal';
      return;
    }
    if (key === 'Enter') {
      const line = this.commandLine;
      this.commandLine = '';
      this.mode = 'normal';
      if (line.startsWith('/')) this.runSearch(line.slice(1));
      else this.runEx(line.slice(1));
      return;
    }
    if (key.length === 1) this.commandLine += key;
  }

  // ---------------------------------------------------------------- search

  private runSearch(pattern: string): void {
    if (pattern === '') {
      this.repeatSearch(false);
      return;
    }
    let re: RegExp;
    try {
      re = new RegExp(pattern);
    } catch {
      this.fail(`E486: Invalid pattern: ${pattern}`);
      return;
    }
    this.lastSearch = re;
    if (!this.buffer.search(re)) this.fail(`E486: Pattern not found: ${pattern}`);
  }

  private repeatSearch(backwards: boolean): void {
    if (!this.lastSearch) {
      this.fail('E35: No previous regular expression');
      return;
    }
    if (!this.buffer.search(this.lastSearch, backwards)) {
      this.fail('E486: Pattern not found');
    }
  }

  // ------------------------------------------------------------------- ex

  private runEx(raw: string): void {
    const command = raw.trim();
    if (command === '') return;

    // A bare number is "go to that line", which is most of what ex gets used
    // for once someone has seen a compiler error message.
    if (/^\d+$/.test(command)) {
      this.buffer.moveTo(parseInt(command, 10) - 1, 0);
      return;
    }
    if (command === '$') {
      this.buffer.moveTo(this.buffer.count - 1, 0);
      return;
    }

    const substitute = /^(%|\d+(?:,\d+)?)?s\/((?:[^\/\\]|\\.)*)\/((?:[^\/\\]|\\.)*)\/?(g?)$/.exec(command);
    if (substitute) return this.runSubstitute(substitute);

    switch (command) {
      case 'w': return this.write(false, false);
      case 'w!': return this.write(false, true);
      case 'wq': case 'x': case 'xit': return this.write(true, false);
      case 'wq!': case 'x!': return this.write(true, true);
      case 'q':
        if (this.buffer.dirty) {
          this.fail('E37: No write since last change (add ! to override)');
          return;
        }
        this.finished = { write: false, text: this.buffer.toText() };
        return;
      case 'q!': case 'quit!':
        this.finished = { write: false, text: this.buffer.toText(), message: '' };
        return;
      case 'set number': case 'set nu': this.showNumbers = true; return;
      case 'set nonumber': case 'set nonu': this.showNumbers = false; return;
      case 'help':
        this.note('vi subset: hjkl 0 ^ $ w b gg G  x dd dw D r J u  i a o O  :w :q :q! :wq  /pat n');
        return;
      default:
        this.fail(`E492: Not an editor command: ${command}`);
    }
  }

  private runSubstitute(m: RegExpExecArray): void {
    const [, range, pattern = '', replacement = '', global] = m;
    let re: RegExp;
    try {
      re = new RegExp(pattern, global === 'g' ? 'g' : '');
    } catch {
      this.fail(`E486: Invalid pattern: ${pattern}`);
      return;
    }

    let from = this.buffer.cursor.line;
    let to = from;
    if (range === '%') {
      from = 0;
      to = this.buffer.count - 1;
    } else if (range && range.includes(',')) {
      const [a, b] = range.split(',');
      from = parseInt(a ?? '1', 10) - 1;
      to = parseInt(b ?? '1', 10) - 1;
    } else if (range) {
      from = to = parseInt(range, 10) - 1;
    }

    const changed = this.buffer.substitute(re, replacement, from, to);
    if (changed === 0) this.fail(`E486: Pattern not found: ${pattern}`);
    else this.note(`${changed} substitution${changed === 1 ? '' : 's'}`);
  }

  private write(thenQuit: boolean, force: boolean): void {
    // vi's actual behaviour: the buffer was always editable, and this is where
    // it says no. `!` overrides the editor's own refusal -- the filesystem
    // still gets the last word, and says so through `notify`.
    if (this.readOnly && !force) {
      this.fail('E45: readonly (add ! to override)');
      return;
    }
    const text = this.buffer.toText();
    this.buffer.markClean();
    if (thenQuit) {
      this.finished = { write: true, text, message: `"${this.path}" written` };
      return;
    }
    // A plain `:w` keeps editing, so the shell is told nothing yet.
    this.note(`"${this.path}" ${this.buffer.count}L, ${text.length}C written`);
    this.pendingWrite = text;
  }

  /**
   * Text from a `:w` that did not quit.
   *
   * The file has to hit the disk at that moment, not at exit: a player who
   * types `:w`, switches away and force-quits should still have their work.
   */
  pendingWrite: string | undefined;

  /** The host reporting back, usually a write the disk refused. */
  notify(message: string): void {
    this.fail(message);
    // A refused write did not happen, whatever the buffer was told.
    this.buffer.dirty = true;
  }

  private note(text: string): void {
    this.message = text;
    this.status = 'info';
  }

  private fail(text: string): void {
    this.message = text;
    this.status = 'error';
  }

  // ---------------------------------------------------------------- render

  frame(): FrameLine[] {
    const textRows = this.rows - 1;
    this.scrollIntoView(textRows);

    const lines: FrameLine[] = [];
    const cursor = this.buffer.cursor;
    const gutter = this.showNumbers ? String(this.buffer.count).length + 1 : 0;

    for (let i = 0; i < textRows; i++) {
      const index = this.top + i;
      if (index >= this.buffer.count) {
        // vi's empty-line marker. It is the clearest signal that the file has
        // ended rather than the screen having gone blank.
        lines.push({ text: '~', kind: 'system' });
        continue;
      }
      const prefix = this.showNumbers
        ? String(index + 1).padStart(gutter - 1) + ' '
        : '';
      const body = this.buffer.line(index);
      const row: FrameLine = { text: prefix + body, kind: 'out' };
      if (index === cursor.line) {
        row.kind = 'echo';
        row.cursor = gutter + cursor.col;
      }
      lines.push(row);
    }

    lines.push(this.statusLine());
    return lines;
  }

  private statusLine(): FrameLine {
    if (this.mode === 'command') {
      return { text: this.commandLine, kind: 'echo', cursor: this.commandLine.length };
    }
    if (this.message !== '') {
      return { text: this.message.slice(0, this.cols), kind: this.status === 'error' ? 'err' : 'system' };
    }

    const left = this.mode === 'insert' ? '-- INSERT --' : this.dirtyMark();
    const right = `${this.buffer.cursor.line + 1},${this.buffer.cursor.col + 1}`;
    const gap = Math.max(1, this.cols - left.length - right.length);
    return { text: left + ' '.repeat(gap) + right, kind: 'system' };
  }

  private dirtyMark(): string {
    const flags = `${this.readOnly ? ' [RO]' : ''}${this.buffer.dirty ? ' [+]' : ''}`;
    // Leave room for the flags and for the ruler the caller appends.
    return `"${this.fitPath(this.cols - flags.length - 10)}"${flags}`;
  }

  /** Keep the cursor on screen, scrolling by the smallest amount that works. */
  private scrollIntoView(textRows: number): void {
    const line = this.buffer.cursor.line;
    if (line < this.top) this.top = line;
    else if (line >= this.top + textRows) this.top = line - textRows + 1;
    this.top = Math.max(0, Math.min(this.top, Math.max(0, this.buffer.count - 1)));
  }

  /** For tests and for the shell: the current text without exiting. */
  get text(): string {
    return this.buffer.toText();
  }
}
