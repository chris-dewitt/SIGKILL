import { highlight, TerminalView } from '@sigkill/crt';
import { applyWrite, chipKeystrokes, flushPendingWrite } from '@sigkill/editor';
import { path as vpath, type ScreenProgram } from '@sigkill/machine';
import { WorkerPythonRuntime } from '@sigkill/python';
import { whatNow, type BeatLine } from '@sigkill/quest';
import { bootWreck, coldOpen, epilogue } from '@sigkill/wreck';

const { machine, questbook } = bootWreck();

/**
 * Python is lazy on purpose.
 *
 * Constructing this costs nothing; the worker spawns and Pyodide's twelve
 * megabytes load on the first `python3` and never before. A player still
 * learning `ls` should not pay for an interpreter they have not reached.
 */
machine.python = new WorkerPythonRuntime({
  indexURL: new URL('pyodide/', document.baseURI).href,
  createWorker: () =>
    new Worker(new URL('./python.worker.ts', import.meta.url), { type: 'module' }),
});

const screen = document.querySelector<HTMLDivElement>('#screen')!;

/**
 * The phosphor screen.
 *
 * `?plain` disables the shader — for a device without WebGL2, and for anyone
 * who finds the persistence uncomfortable. It becomes a real setting once
 * there is a settings screen to put it in.
 */
const view = new TerminalView(screen, {
  font: '13.5px "SFMono-Regular", ui-monospace, "Roboto Mono", Menlo, Consolas, monospace',
  gutter: 16,
  plain: new URLSearchParams(location.search).has('plain'),
});
const input = document.querySelector<HTMLInputElement>('#input')!;
const promptEl = document.querySelector<HTMLLabelElement>('#prompt')!;
const form = document.querySelector<HTMLFormElement>('#line')!;
const chips = document.querySelector<HTMLDivElement>('#chips')!;
const symbols = document.querySelector<HTMLDivElement>('#symbols')!;
const tabButton = document.querySelector<HTMLButtonElement>('#tab')!;

const history: string[] = [];
let historyIndex = -1;

/**
 * Commands are async now, and some of them (Python, a remote host) take real
 * time. One command runs at a time: a second Enter while one is in flight
 * would interleave output and race the machine's state.
 */
let busy = false;

/** Once Pyodide is loaded, later runs are fast and need no notice. */
let pythonWarmed = false;

/**
 * The full-screen program that owns the screen, if any.
 *
 * While this is set the prompt is hidden, every keystroke goes to the program
 * instead of the shell, and the chip bar shows the program's own keys -- which
 * is the entire answer to "how do you press Escape on a phone".
 */
let screenProgram: ScreenProgram | undefined;

/** Characters a shell needs constantly that Android buries two taps deep. */
const SYMBOL_KEYS = ['|', '/', '-', '~', '$', '*', '>', '.', "'", '"'];

type LineKind = 'out' | 'err' | 'echo' | 'system';

function write(text: string, kind: LineKind = 'out'): void {
  view.push(text, kind);
}

function writeBlock(text: string, kind: LineKind): void {
  view.write(text, kind);
}

/**
 * Say a beat: prose wraps, art clips.
 *
 * The distinction is per line rather than per beat because the beats that
 * matter are prose with a picture in the middle of them.
 */
function sayBeat(lines: readonly BeatLine[], kind: LineKind = 'system'): void {
  for (const line of lines) {
    if (typeof line === 'string') write(line, kind);
    else view.writeArt([line.art], kind);
  }
}

/**
 * Write output whose columns are load-bearing.
 *
 * A drawing that goes through the prose path gets word-wrapped and its
 * trailing spaces trimmed, which is precisely the information holding it
 * together. `writeArt` clips instead, so a picture too wide for a phone loses
 * its right edge rather than becoming confetti.
 */
function writeArt(text: string, kind: LineKind): void {
  if (text.length === 0) return;
  const rows = text.split('\n');
  if (rows[rows.length - 1] === '') rows.pop();
  view.writeArt(rows, kind);
}

function scrollToEnd(): void {
  view.scrollToBottom();
}

/*
 * Colour every line the view writes.
 *
 * Installed here rather than inside the view because the rules need to know
 * which words are commands this machine will actually run -- colouring a word
 * as typeable when the ship does not have it is worse than leaving it plain.
 */
view.highlighter = (text) => highlight(text, { commands: new Set(machine.shell.commands.keys()) });

function refreshPrompt(): void {
  promptEl.textContent = machine.prompt;
}

async function submit(raw: string): Promise<void> {
  const command = raw.trim();
  write(machine.prompt + command, 'echo');

  if (command.length > 0) {
    history.push(command);
    historyIndex = history.length;

    busy = true;
    input.disabled = true;
    // The first python3 loads an interpreter. Say so rather than appearing hung.
    const slow = command.startsWith('python') && !pythonWarmed
      ? window.setTimeout(() => write('[loading interpreter...]', 'system'), 350)
      : undefined;
    try {
      const result = await machine.exec(command);
      if (result.cleared) {
        view.clear();
      } else {
        // Walked per segment rather than read once off the result: one command
        // line can mix a drawing and a paragraph, and the two need opposite
        // treatment. stderr is always prose.
        for (const segment of result.segments) {
          if (segment.preformatted) writeArt(segment.text, 'out');
          else writeBlock(segment.text, 'out');
        }
        writeBlock(result.stderr, 'err');
      }
      if (result.screen) enterScreen(result.screen);
      machine.tick(1000);
      playBeats();
      checkActComplete();
    } finally {
      if (slow !== undefined) window.clearTimeout(slow);
      if (command.startsWith('python')) pythonWarmed = true;
      busy = false;
      // Staying disabled is only correct when the session itself ended.
      input.disabled = machine.exited !== null;
    }

    if (machine.exited !== null) {
      write('', 'system');
      write('[session closed]', 'system');
    }
  }

  refreshPrompt();
  refreshChips();
  scrollToEnd();
  if (!input.disabled) input.focus();
}

/**
 * Play the beat for any objective that just closed.
 *
 * Checked after every command rather than hung off a particular one: the goals
 * are solution-agnostic, so the player can finish an objective with `sed`, an
 * editor, or Python, and the moment has to land whichever route they took.
 */
function playBeats(): void {
  let closed = false;
  for (const objective of questbook.drainCompleted(machine)) {
    sayBeat(objective.onComplete ?? []);
    closed = true;
  }
  // Finishing one thing is exactly the moment a player asks "so now what".
  // Answering unprompted is the difference between a board they have to know
  // to ask for and one they cannot miss.
  if (closed && !questbook.complete(machine)) sayBeat(whatNow(questbook, machine));
}

/**
 * Play the act's ending, once.
 *
 * Checked after every command rather than tied to a particular one, because
 * the objectives are solution-agnostic: the player can finish the act with
 * `sed`, with vi, or from Python, and the ending has to land either way.
 */
let actEnded = false;
function checkActComplete(): void {
  if (actEnded || !questbook.complete(machine)) return;
  actEnded = true;
  sayBeat(epilogue(machine));
}

// ---------------------------------------------------------------- full screen

/**
 * Hand the screen to a full-screen program.
 *
 * The prompt is hidden rather than disabled: a visible text field under a vi
 * session invites people to type into the wrong place, and on a phone it would
 * also keep the soft keyboard's Enter bound to the shell.
 */
function enterScreen(program: ScreenProgram): void {
  screenProgram = program;
  program.resize(view.rows, view.columns);

  // The input stays in the DOM and stays focused, only collapsed out of sight.
  // Hiding it outright would dismiss the soft keyboard, and then a phone
  // player could tap chips but never type a single character.
  form.classList.add('screen-mode');
  symbols.hidden = true;
  input.value = '';
  // submit() disables the field while a command runs and re-enables it in its
  // own finally block, so focusing here would be focusing a disabled element.
  queueMicrotask(keepFocus);

  paintScreen();
  refreshChips();
}

function paintScreen(): void {
  if (!screenProgram) return;
  screenProgram.resize(view.rows, view.columns);
  view.showScreen(screenProgram.frame());
}

function screenKey(key: string, ctrl = false): void {
  const program = screenProgram;
  if (!program) return;

  program.key({ key, ctrl });

  // The program's own user, not the shell's: under sudo they differ, and the
  // shell has already reverted by the time a keystroke gets here.
  const failed = flushPendingWrite(machine.active.vfs, program, program.user);
  if (failed) {
    // The program owns the screen, so the scrollback is behind its frame. Tell
    // the program instead, and it puts the message on its own status line.
    program.notify?.(failed);
  }

  const done = program.exit;
  if (!done) {
    paintScreen();
    refreshChips();
    return;
  }

  // Leaving: put the scrollback back exactly as it was, which is what a real
  // terminal does and why this was an overlay rather than a clear.
  view.hideScreen();
  screenProgram = undefined;
  form.classList.remove('screen-mode');
  symbols.hidden = false;
  input.value = '';

  if (done.write) {
    const error = applyWrite(machine.active.vfs, program.path, done.text, program.user);
    if (error) write(`${program.name}: ${error}`, 'err');
    else if (done.message) write(done.message, 'system');
  } else if (done.message) {
    write(done.message, 'system');
  }

  refreshPrompt();
  refreshChips();
  scrollToEnd();
  input.focus();
}

// ---------------------------------------------------------------- completion

/** Complete a command name at the start of the line, a path anywhere else. */
function complete(value: string): { completed: string; options: string[] } {
  const trailingSpace = /\s$/.test(value);
  const tokens = value.split(/\s+/).filter((t) => t.length > 0);
  const editing = trailingSpace ? '' : (tokens[tokens.length - 1] ?? '');
  const isCommandSlot = tokens.length === 0 || (tokens.length === 1 && !trailingSpace);

  let candidates: string[];
  let replaceFrom = editing;

  if (isCommandSlot) {
    candidates = [...machine.shell.commands.keys()].filter((n) => n.startsWith(editing)).sort();
  } else {
    const slash = editing.lastIndexOf('/');
    const dir = slash < 0 ? '.' : editing.slice(0, slash + 1);
    const stem = slash < 0 ? editing : editing.slice(slash + 1);
    let entries: string[] = [];
    try {
      entries = machine.vfs.readdir(machine.shell.resolve(dir), machine.shell.user);
    } catch {
      entries = [];
    }
    candidates = entries
      .filter((e) => e.startsWith(stem) && (stem.startsWith('.') || !e.startsWith('.')))
      .map((e) => {
        const full = dir === '.' ? e : dir + e;
        let suffix = '';
        try {
          if (machine.vfs.stat(machine.shell.resolve(full), machine.shell.user).kind === 'dir') {
            suffix = '/';
          }
        } catch { /* a broken link still completes, just without the slash */ }
        return full + suffix;
      })
      .sort();
    replaceFrom = editing;
  }

  if (candidates.length === 0) return { completed: value, options: [] };

  const shared = commonPrefix(candidates);
  const head = value.slice(0, value.length - replaceFrom.length);
  const only = candidates.length === 1 && candidates[0];
  const completed = head + (only ? (only.endsWith('/') ? only : only + ' ') : shared);

  return { completed, options: candidates.length > 1 ? candidates : [] };
}

function commonPrefix(values: string[]): string {
  if (values.length === 0) return '';
  let prefix = values[0]!;
  for (const value of values.slice(1)) {
    while (!value.startsWith(prefix)) prefix = prefix.slice(0, -1);
  }
  return prefix;
}

function applyCompletion(): void {
  const { completed, options } = complete(input.value);
  if (completed !== input.value) {
    input.value = completed;
  } else if (options.length > 0) {
    write(machine.prompt + input.value, 'echo');
    write(options.join('  '), 'out');
    scrollToEnd();
  }
  input.focus();
  refreshChips();
}

// --------------------------------------------------------------------- chips

/** How many chips fit without the bar wrapping on a phone. */
const CHIP_SLOTS = 6;

/**
 * The chip bar reads the room: what you have typed, and what is actually
 * in front of you. On a phone this is not a convenience, it is the input method.
 */
function suggestions(): string[] {
  // A full-screen program names its own keys, and they change with its mode.
  if (screenProgram) return [...screenProgram.chips];

  const value = input.value;
  const tokens = value.split(/\s+/).filter((t) => t.length > 0);

  if (tokens.length === 0) {
    /*
     * The two that are never allowed to fall off the end.
     *
     * They used to be pushed last and then cut by the slice below, which is
     * the worst possible outcome: the comment promised they were always one
     * tap away and the code quietly removed them, so the bar was at its least
     * useful exactly when a stuck player looked at it. Reserved now, and
     * asserted in a test.
     */
    const always = ['hint', 'objectives'];

    const here = listHere();
    const rest = ['ls', 'cat', 'cd', 'pwd', 'grep'];
    if (here.some((e) => e.endsWith('.log'))) rest.push('tail');
    if (here.includes('README')) rest.unshift('cat README');

    const room = Math.max(0, CHIP_SLOTS - always.length);
    return [...always, ...[...new Set(rest)].filter((c) => !always.includes(c)).slice(0, room)];
  }

  if (tokens.length === 1 && !/\s$/.test(value)) {
    return [...machine.shell.commands.keys()]
      .filter((n) => n.startsWith(tokens[0]!) && n !== tokens[0])
      .sort()
      .slice(0, CHIP_SLOTS);
  }

  return listHere().slice(0, CHIP_SLOTS);
}

function listHere(): string[] {
  try {
    return machine.vfs.readdir(machine.shell.cwd, machine.shell.user);
  } catch {
    return [];
  }
}

function refreshChips(): void {
  chips.replaceChildren();
  for (const suggestion of suggestions()) {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'chip';
    chip.textContent = suggestion;
    holdFocusOnTap(chip);

    if (screenProgram) {
      chip.addEventListener('click', () => {
        for (const k of chipKeystrokes(suggestion)) screenKey(k.key, k.ctrl ?? false);
        // The chip bar is rebuilt on every keystroke, so the button that was
        // tapped no longer exists and focus would land on <body> -- which on a
        // phone drops the soft keyboard and silently swallows everything typed
        // next. Put focus back on the field that receives keys.
        keepFocus();
      });
      chips.append(chip);
      continue;
    }

    chip.addEventListener('click', () => {
      const value = input.value;
      const trailing = /\s$/.test(value) || value.length === 0;
      const tokens = value.split(/\s+/).filter((t) => t.length > 0);
      if (!trailing && tokens.length > 0) tokens.pop();
      input.value = [...tokens, suggestion].join(' ') + ' ';
      input.focus();
      refreshChips();
    });
    chips.append(chip);
  }
}

/**
 * Return focus to the field that receives keystrokes.
 *
 * `preventDefault` on pointerdown stops the button taking focus at all, which
 * is the real fix; this is the belt to that braces, for taps that arrive
 * without a pointer event and for the rebuild that follows each keystroke.
 */
function keepFocus(): void {
  if (!input.disabled) input.focus();
}

/** Keep a tap on an on-screen key from moving focus off the input. */
function holdFocusOnTap(button: HTMLElement): void {
  button.addEventListener('pointerdown', (event) => event.preventDefault());
  button.addEventListener('mousedown', (event) => event.preventDefault());
}

function buildSymbolRow(): void {
  for (const key of SYMBOL_KEYS) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'symbol';
    button.textContent = key;
    holdFocusOnTap(button);
    button.addEventListener('click', () => {
      const start = input.selectionStart ?? input.value.length;
      const end = input.selectionEnd ?? start;
      input.value = input.value.slice(0, start) + key + input.value.slice(end);
      const caret = start + key.length;
      input.setSelectionRange(caret, caret);
      input.focus();
      refreshChips();
    });
    symbols.append(button);
  }
}

// --------------------------------------------------------------------- wiring

form.addEventListener('submit', (event) => {
  event.preventDefault();
  if (screenProgram || busy) return;
  const value = input.value;
  input.value = '';
  void submit(value);
});

/**
 * Text typed while a full-screen program owns the screen.
 *
 * Soft keyboards are the reason this exists as well as the keydown path: many
 * Android keyboards report `Unidentified` for keydown and only tell the truth
 * through an input event. Whatever lands in the field is forwarded a character
 * at a time and the field is emptied again.
 */
input.addEventListener('input', () => {
  if (!screenProgram) {
    refreshChips();
    return;
  }
  const typed = input.value;
  input.value = '';
  for (const ch of typed) screenKey(ch);
});

input.addEventListener('keydown', (event) => {
  if (screenProgram) {
    const named = new Set([
      'Escape', 'Enter', 'Backspace', 'Tab', 'Delete',
      'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End',
    ]);
    if (named.has(event.key)) {
      event.preventDefault();
      screenKey(event.key);
      return;
    }
    if (event.ctrlKey && event.key.length === 1) {
      // ^O and ^X are nano's save and quit, and the browser wants both.
      event.preventDefault();
      screenKey(event.key, true);
      return;
    }
    // A printable character from a real keyboard: handle it here so the field
    // never holds text. Anything else falls through to the input event above.
    if (event.key.length === 1 && !event.metaKey && !event.altKey) {
      event.preventDefault();
      screenKey(event.key);
    }
    return;
  }

  if (event.key === 'Tab') {
    event.preventDefault();
    applyCompletion();
    return;
  }
  if (event.key === 'ArrowUp') {
    event.preventDefault();
    if (historyIndex > 0) {
      historyIndex--;
      input.value = history[historyIndex] ?? '';
      refreshChips();
    }
    return;
  }
  if (event.key === 'ArrowDown') {
    event.preventDefault();
    if (historyIndex < history.length - 1) {
      historyIndex++;
      input.value = history[historyIndex] ?? '';
    } else {
      historyIndex = history.length;
      input.value = '';
    }
    refreshChips();
  }
});

holdFocusOnTap(tabButton);
tabButton.addEventListener('click', () => {
  if (screenProgram) screenKey('Tab');
  else applyCompletion();
});

// Tapping anywhere on the screen focuses the line, the way a terminal should.
screen.addEventListener('click', () => {
  if (window.getSelection()?.toString()) return;
  if (!input.disabled) input.focus();
});

// Scrolling the canvas is ours to implement: it is a picture, not a document.
screen.addEventListener(
  'wheel',
  (event) => {
    event.preventDefault();
    view.scrollBy(Math.sign(event.deltaY) * 3);
  },
  { passive: false },
);

let touchY: number | null = null;
screen.addEventListener('touchstart', (e) => { touchY = e.touches[0]?.clientY ?? null; }, { passive: true });
screen.addEventListener('touchmove', (e) => {
  const y = e.touches[0]?.clientY;
  if (y === undefined || touchY === null) return;
  const delta = touchY - y;
  // One row per ~18px of drag, which is roughly one line height.
  if (Math.abs(delta) >= 18) {
    view.scrollBy(Math.trunc(delta / 18));
    touchY = y;
  }
}, { passive: true });
screen.addEventListener('touchend', () => { touchY = null; }, { passive: true });

// A rotation or a keyboard appearing changes the grid; the program has to be
// told, or it keeps drawing to the old geometry.
window.addEventListener('resize', () => {
  if (screenProgram) paintScreen();
});

sayBeat(coldOpen(machine));
sayBeat(whatNow(questbook, machine));
refreshPrompt();
buildSymbolRow();
refreshChips();
scrollToEnd();
input.focus();

// Exported for the console during development.
Object.assign(window, { machine, questbook, vpath, view });
