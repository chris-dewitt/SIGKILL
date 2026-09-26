import type { EditorExit, EditorKey, EditorOptions, FrameLine, FullscreenProgram } from './types.js';

/**
 * `less`.
 *
 * The first full-screen program here that is not an editor, and the reason
 * this package is really "programs that take the screen" rather than
 * "editors". It shares the contract and nothing else: there is no
 * `TextBuffer`, because a pager never changes anything, and pretending
 * otherwise would mean a `:w` path that must never fire.
 *
 * It exists for `/var/log/hull.log`. Five hundred and forty lines is the
 * number the act uses to teach that nobody reads a log -- you search it --
 * and until now the ship had no way to *show* somebody a long file, so the
 * lesson landed as a wall of text scrolling past. A pager makes the length
 * legible, which is what makes `grep` feel like a relief rather than an
 * instruction.
 *
 * Real `less` keys, because the point of this project is that what you learn
 * here works on a real machine. Notably `q` really does quit, which is the
 * single most important key in the program and the one people are most often
 * stranded without.
 */

/** How many rows the status line takes off the bottom. */
const STATUS_ROWS = 1;

export class Pager implements FullscreenProgram {
  readonly name = 'less';

  private readonly lines: readonly string[];
  private rows: number;
  private cols: number;
  readonly path: string;
  readonly user: { uid: number; gid: number; name: string };

  /** First visible line. */
  private top = 0;
  private finished: EditorExit | null = null;

  /** The last search, so `n` has something to repeat. */
  private pattern = '';
  /** Set while the player is typing a `/` search. */
  private typing: string | null = null;
  private message = '';

  constructor(text: string, opts: EditorOptions) {
    // A trailing newline is a line terminator, not an empty last line. Without
    // this every file in the game reads as one line longer than `wc -l` says,
    // and the percentage in the status bar never reaches 100%.
    const body = text.endsWith('\n') ? text.slice(0, -1) : text;
    this.lines = body.length === 0 ? [''] : body.split('\n');
    this.rows = Math.max(4, opts.rows);
    this.cols = Math.max(20, opts.cols);
    this.path = opts.path;
    this.user = opts.user ?? { uid: 0, gid: 0, name: 'root' };
  }

  get exit(): EditorExit | null {
    return this.finished;
  }

  resize(rows: number, cols: number): void {
    this.rows = Math.max(4, rows);
    this.cols = Math.max(20, cols);
    this.clamp();
  }

  notify(message: string): void {
    this.message = message;
  }

  /** How many lines of the file are on screen at once. */
  private get page(): number {
    return Math.max(1, this.rows - STATUS_ROWS);
  }

  /** The furthest down we may scroll: the last page, not the last line. */
  private get maxTop(): number {
    return Math.max(0, this.lines.length - this.page);
  }

  private clamp(): void {
    this.top = Math.min(Math.max(0, this.top), this.maxTop);
  }

  get chips(): readonly string[] {
    if (this.typing !== null) return ['Enter', 'ESC'];
    return ['SPACE', 'b', 'j', 'k', 'g', 'G', '/', 'n', 'q'];
  }

  key(k: EditorKey): void {
    if (this.finished) return;
    if (this.typing !== null) return this.searchKey(k);

    // Ctrl-F and Ctrl-B page in real less, and a physical keyboard reaches for
    // them before it reaches for the space bar.
    if (k.ctrl) {
      if (k.key.toLowerCase() === 'f') return this.scroll(this.page);
      if (k.key.toLowerCase() === 'b') return this.scroll(-this.page);
      return;
    }

    switch (k.key) {
      case 'q':
      case 'Q':
        // No write, ever. A pager that could save would be a pager with a bug.
        this.finished = { write: false, text: '' };
        return;

      case ' ':
      case 'f':
      case 'PageDown':
        return this.scroll(this.page);

      case 'b':
      case 'PageUp':
        return this.scroll(-this.page);

      case 'd':
        return this.scroll(Math.floor(this.page / 2));
      case 'u':
        return this.scroll(-Math.floor(this.page / 2));

      case 'j':
      case 'Enter':
      case 'ArrowDown':
        return this.scroll(1);

      case 'k':
      case 'ArrowUp':
        return this.scroll(-1);

      case 'g':
      case 'Home':
        this.top = 0;
        this.message = '';
        return;

      case 'G':
      case 'End':
        this.top = this.maxTop;
        this.message = '';
        return;

      case '/':
        this.typing = '';
        this.message = '';
        return;

      case 'n':
        return this.repeat(1);
      case 'N':
        return this.repeat(-1);

      default:
        return;
    }
  }

  private scroll(by: number): void {
    this.top += by;
    this.message = '';
    this.clamp();
  }

  private searchKey(k: EditorKey): void {
    const typed = this.typing ?? '';
    if (k.key === 'Escape') {
      this.typing = null;
      return;
    }
    if (k.key === 'Enter') {
      this.typing = null;
      this.pattern = typed;
      if (typed.length > 0) this.repeat(1);
      return;
    }
    if (k.key === 'Backspace') {
      // Backspacing past the `/` leaves the prompt, the way it does in less.
      this.typing = typed.length > 0 ? typed.slice(0, -1) : null;
      return;
    }
    if (k.key.length === 1) this.typing = typed + k.key;
  }

  /**
   * Jump to the next line matching the last pattern.
   *
   * Case-insensitive when the pattern is all lower case, which is what `less`
   * does with `-i` and what people expect after using a search box. A pattern
   * with a capital in it is taken literally.
   */
  private repeat(direction: 1 | -1): void {
    if (this.pattern.length === 0) {
      this.message = 'No previous search';
      return;
    }
    const fold = this.pattern === this.pattern.toLowerCase();
    const needle = fold ? this.pattern.toLowerCase() : this.pattern;
    const hit = (line: string): boolean =>
      (fold ? line.toLowerCase() : line).includes(needle);

    const last = this.lines.length - 1;
    for (let i = this.top + direction; i >= 0 && i <= last; i += direction) {
      if (hit(this.lines[i] ?? '')) {
        this.top = i;
        this.message = '';
        this.clamp();
        return;
      }
    }
    this.message = `Pattern not found: ${this.pattern}`;
  }

  frame(): FrameLine[] {
    const out: FrameLine[] = [];
    const page = this.page;

    for (let i = 0; i < page; i++) {
      const line = this.lines[this.top + i];
      // Past the end of a short file, `less` shows `~` like vi does.
      out.push(
        line === undefined
          ? { text: '~', kind: 'system' }
          : { text: line.slice(0, this.cols), kind: 'out' },
      );
    }

    out.push(this.statusLine());
    return out;
  }

  private statusLine(): FrameLine {
    if (this.typing !== null) {
      const text = `/${this.typing}`;
      return { text: text.slice(0, this.cols), kind: 'system', cursor: Math.min(text.length, this.cols - 1) };
    }
    if (this.message.length > 0) {
      return { text: this.message.slice(0, this.cols), kind: 'err' };
    }

    const lastShown = Math.min(this.lines.length, this.top + this.page);
    const done = this.top >= this.maxTop;
    // The percentage is of what you have *seen*, not of where the cursor is,
    // which is why a file shorter than one screen reads END immediately.
    const percent = this.lines.length === 0 ? 100 : Math.round((lastShown / this.lines.length) * 100);
    const where = done ? '(END)' : `${percent}%`;

    /*
     * Built shortest-first, because the first draft truncated at forty columns
     * and the two things it cut were `(END)` and `q to quit` -- the position
     * and the way out, which are the only parts anybody needs. A phone is
     * thirty-four columns wide, so the filename is the luxury here, not the
     * escape hatch.
     */
    const escape = 'q to quit';
    const position = `${this.top + 1}-${lastShown}/${this.lines.length} ${where}`;
    const name = this.path.slice(this.path.lastIndexOf('/') + 1);

    for (const candidate of [
      `${this.path}  lines ${position}  (${escape})`,
      `${name}  ${position}  (${escape})`,
      `${position}  (${escape})`,
      `${position}  q`,
      position,
    ]) {
      if (candidate.length <= this.cols) return { text: candidate, kind: 'system' };
    }
    return { text: position.slice(0, this.cols), kind: 'system' };
  }
}
