import { path as vpath } from '@sigkill/machine';
import { WorkerPythonRuntime } from '@sigkill/python';
import { bootWreck, COLD_OPEN } from './world.js';

const machine = bootWreck();

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

/** Characters a shell needs constantly that Android buries two taps deep. */
const SYMBOL_KEYS = ['|', '/', '-', '~', '$', '*', '>', '.', "'", '"'];

function write(text: string, kind: 'out' | 'err' | 'echo' | 'system' = 'out'): void {
  if (text.length === 0) return;
  const line = document.createElement('div');
  line.className = `row row-${kind}`;
  line.textContent = text;
  screen.append(line);
}

function writeBlock(text: string, kind: 'out' | 'err' | 'system'): void {
  const rows = text.split('\n');
  if (rows[rows.length - 1] === '') rows.pop();
  for (const row of rows) {
    // A blank line still needs to occupy a row.
    write(row.length > 0 ? row : ' ', kind);
  }
}

function scrollToEnd(): void {
  screen.scrollTop = screen.scrollHeight;
}

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
        screen.replaceChildren();
      } else {
        writeBlock(result.stdout, 'out');
        writeBlock(result.stderr, 'err');
      }
      machine.tick(1000);
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

/**
 * The chip bar reads the room: what you have typed, and what is actually
 * in front of you. On a phone this is not a convenience, it is the input method.
 */
function suggestions(): string[] {
  const value = input.value;
  const tokens = value.split(/\s+/).filter((t) => t.length > 0);

  if (tokens.length === 0) {
    const here = listHere();
    const out = ['ls', 'cat', 'cd', 'pwd', 'grep'];
    if (here.some((e) => e.endsWith('.log'))) out.push('tail');
    if (here.includes('README')) out.unshift('cat README');
    return [...new Set(out)].slice(0, 6);
  }

  if (tokens.length === 1 && !/\s$/.test(value)) {
    return [...machine.shell.commands.keys()]
      .filter((n) => n.startsWith(tokens[0]!) && n !== tokens[0])
      .sort()
      .slice(0, 6);
  }

  return listHere().slice(0, 6);
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

function buildSymbolRow(): void {
  for (const key of SYMBOL_KEYS) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'symbol';
    button.textContent = key;
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
  if (busy) return;
  const value = input.value;
  input.value = '';
  void submit(value);
});

input.addEventListener('input', refreshChips);

input.addEventListener('keydown', (event) => {
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

tabButton.addEventListener('click', applyCompletion);

// Tapping anywhere on the screen focuses the line, the way a terminal should.
screen.addEventListener('click', () => {
  if (window.getSelection()?.toString()) return;
  if (!input.disabled) input.focus();
});

for (const line of COLD_OPEN) write(line.length > 0 ? line : ' ', 'system');
refreshPrompt();
buildSymbolRow();
refreshChips();
scrollToEnd();
input.focus();

// A path helper is exported for the console during development.
Object.assign(window, { machine, vpath });
