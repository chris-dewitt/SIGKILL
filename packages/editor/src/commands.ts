import { FsError, ROOT_USER, type CommandSpec, type ScreenProgram, type User, type Vfs } from '@sigkill/machine';
import { NanoEditor } from './nano.js';
import { ViEditor } from './vi.js';
import type { EditorOptions } from './types.js';

export interface EditorCommandOptions {
  /** Rows and columns the host will draw with. Refined by the host on open. */
  rows?: number;
  cols?: number;
}

interface Target {
  text: string;
  isNew: boolean;
  readOnly: boolean;
}

/** Can this user actually write here? Asked before the editor opens, not after. */
function inspect(vfs: Vfs, path: string, user: { uid: number; gid: number; name: string }): Target | string {
  let exists = false;
  try {
    const stat = vfs.lstat(path, ROOT_USER);
    exists = true;
    if (stat.kind === 'dir') return `${path}: is a directory`;
  } catch {
    exists = false;
  }

  if (!exists) {
    // A new file is only openable if the directory will accept it. Finding out
    // at `:w` instead is how people lose work in real editors.
    const dir = path.slice(0, path.lastIndexOf('/')) || '/';
    try {
      if (!vfs.access(dir, 'w', user)) return `${path}: permission denied`;
    } catch {
      return `${path}: no such file or directory`;
    }
    return { text: '', isNew: true, readOnly: false };
  }

  let text: string;
  try {
    text = vfs.readText(path, user);
  } catch (e) {
    return `${path}: ${e instanceof FsError ? e.message : 'cannot be read'}`;
  }
  return { text, isNew: false, readOnly: !vfs.access(path, 'w', user) };
}

/**
 * `vi`, `vim` and `nano`.
 *
 * They return immediately: the command's whole job is to hand a program to the
 * host through `ctx.screenRequest`, and the host drives it. That keeps the
 * editor out of the Machine (which has no dependencies and no screen) and
 * keeps the editor itself a pure state machine with no DOM in sight.
 */
export function editorCommands(opts: EditorCommandOptions = {}): CommandSpec[] {
  const geometry = { rows: opts.rows ?? 24, cols: opts.cols ?? 60 };

  const launch = (
    make: (text: string, o: EditorOptions) => ScreenProgram,
    name: string,
  ): CommandSpec['run'] => (ctx, argv, io) => {
    const operand = argv[1];
    if (operand === undefined) {
      io.err(`${name}: which file?\nTry: ${name} /etc/life_support.conf\n`);
      return 1;
    }

    const path = ctx.resolve(operand);
    const found = inspect(ctx.vfs, path, ctx.user);
    if (typeof found === 'string') {
      io.err(`${name}: ${found}\n`);
      return 1;
    }

    ctx.screenRequest = make(found.text, {
      rows: geometry.rows,
      cols: geometry.cols,
      path,
      isNew: found.isNew,
      readOnly: found.readOnly,
    });
    return 0;
  };

  const viManual =
    'vi [file]\n\n' +
    'Modal editor. It starts in normal mode, where the keys are commands.\n' +
    '  i a o O    start typing (insert mode); Escape returns to normal\n' +
    '  h j k l    left down up right, or the arrow keys\n' +
    '  0 ^ $      start of line, first non-blank, end of line\n' +
    '  w b        forward and back a word;  gg G  top and bottom\n' +
    '  x dd dw D  delete a character, a line, a word, to end of line\n' +
    '  r<c>  J    replace one character, join with the next line\n' +
    '  u  Ctrl-r  undo, redo;  yy p  yank a line, put it back\n' +
    '  /pattern   search;  n N  next and previous match\n' +
    '  :w :q :wq  write, quit, both;  :q!  quit and discard\n' +
    '  :%s/a/b/g  substitute through the whole file\n' +
    '  ZZ         write and quit, which is how most people leave\n' +
    'Not implemented: visual mode, marks, macros, named registers.';

  const viPlain =
    'A text editor. It has two states and that trips everyone up once:\n' +
    '  - It opens in COMMAND state. Letters do things, they do not type.\n' +
    '  - Press  i  to start typing. Press  Escape  to stop.\n' +
    'To save and leave:  Escape  then  :wq  then Enter.\n' +
    'To leave without saving:  Escape  then  :q!  then Enter.\n' +
    'Made a mess? Escape, then  u  undoes it.\n' +
    'If you would rather not deal with states, try:  nano';

  const nanoManual =
    'nano [file]\n\n' +
    'Non-modal editor: typing types. The shortcuts are printed at the\n' +
    'bottom of the screen, so nothing has to be remembered.\n' +
    '  ^O  write the file out        ^K  cut the current line\n' +
    '  ^X  exit (asks to save)       ^U  paste a line back\n' +
    '  ^A  start of line             ^E  end of line\n' +
    '  ^C  where am I                ^G  the list of keys\n' +
    '^ means Ctrl. On a phone, the buttons under the screen are the same keys.';

  const nanoPlain =
    'The friendly editor. Just start typing.\n' +
    'When you are done:  Ctrl-O  saves, then  Ctrl-X  leaves.\n' +
    'The keys are always written at the bottom of the screen, so there is\n' +
    'nothing to memorise and no way to get stuck.';

  const vi: CommandSpec['run'] = launch((text, o) => new ViEditor(text, o), 'vi');

  return [
    { name: 'vi', summary: 'edit a file (modal)', manual: viManual, plain: viPlain, run: vi },
    { name: 'vim', summary: 'edit a file (modal)', manual: viManual, plain: viPlain, run: vi },
    {
      name: 'nano',
      summary: 'edit a file (non-modal)',
      manual: nanoManual,
      plain: nanoPlain,
      run: launch((text, o) => new NanoEditor(text, o), 'nano'),
    },
  ];
}

/**
 * Put an editor's text on the disk, as the player.
 *
 * Lives here rather than in the app so that the browser and the tests share
 * one implementation: a save path that is only exercised through the DOM is a
 * save path nobody checks. Returns an error message, or nothing on success.
 */
export function applyWrite(vfs: Vfs, path: string, text: string, user: User): string | undefined {
  try {
    vfs.writeText(path, text, user);
    return undefined;
  } catch (e) {
    return e instanceof FsError ? `${path}: ${e.message}` : `${path}: cannot be written`;
  }
}

/**
 * Drive a program's save-without-exit, if it has one pending.
 *
 * `:w` has to reach the disk when it is typed. A player who saves, walks away
 * and force-quits should still have their work.
 */
export function flushPendingWrite(
  vfs: Vfs,
  program: ScreenProgram,
  user: User,
): string | undefined {
  const text = program.pendingWrite;
  if (text === undefined) return undefined;
  program.pendingWrite = undefined;
  return applyWrite(vfs, program.path, text, user);
}
