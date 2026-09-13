import {
  DEFAULT_PALETTE, DEFAULT_TUBE, degrade, highlight, paletteByName, PALETTE_NAMES,
  TerminalView, tubeByName, TUBE_NAMES,
} from '@sigkill/crt';
import { applyWrite, chipKeystrokes, flushPendingWrite } from '@sigkill/editor';
import { path as vpath, type CommandSpec, type ScreenProgram } from '@sigkill/machine';
import { WorkerPythonRuntime } from '@sigkill/python';
import { Soundtrack, type ShipState as AudioState } from '@sigkill/audio';
import { whatNow, type BeatLine } from '@sigkill/quest';
import { bootWreck, restoreWreck, coldOpen, epilogue } from '@sigkill/wreck';
import { clearSave, readSave, writeSave, type LastTurn } from './save.js';
import { beatText, pageIsArt, paginateBeats } from './turn.js';

const saved = readSave();
const session = saved
  ? restoreWreck({ machine: saved.machine, quest: saved.quest })
  : bootWreck();
const machine = session.machine;
const questbook = session.questbook;

// A host command: the Machine has no screen and must not learn what a colour
// is, so this is registered onto the shell from out here.

/**
 * Switch the colour scheme from inside the game.
 *
 * A host command rather than a Machine one: the Machine has no screen and must
 * not learn what a colour is. It lives here for the same reason the renderer
 * does, and it is the only honest way to choose a palette -- by looking at the
 * real thing on the real screen, not at a swatch.
 */
/**
 * Turn the ship's noise on and off.
 *
 * A host command for the same reason `palette` is one: the Machine has no
 * speakers and must not learn what a sound is.
 */
/**
 * Choose the tube.
 *
 * A still cannot show flicker and a paragraph cannot show anything, so the
 * only honest way to pick one is to look at each in turn on the screen it will
 * be played on.
 */
function newgameCommand(): CommandSpec {
  return {
    name: 'newgame',
    summary: 'wipe the save and begin again',
    manual:
      'newgame\n\n' +
      'Erase the saved run and reload the cold open. The ship forgets you.\n' +
      'Autosave writes after every command; this is the only way back to berth 3.',
    plain:
      'Starts the game over from the beginning.\n' +
      'Your save is erased. Type it only if you mean it.',
    run: (_ctx, _argv, io) => {
      clearSave();
      io.out('newgame: the ship is forgetting.\n');
      window.setTimeout(() => window.location.reload(), 80);
      return 0;
    },
  };
}

function crtCommand(): CommandSpec {
  return {
    name: 'crt',
    summary: 'change the screen simulation',
    preformatted: true,
    manual:
      'crt [NAME]\n\n' +
      'With no argument, list the tubes and show which one is on.\n\n' +
      '  off       no simulation at all\n' +
      '  clean     a good tube on a good day; holds perfectly still\n' +
      '  classic   scanlines, grille, glow, a slow roll\n' +
      '  worn      eleven years unattended\n' +
      '  failing   the picture is barely holding together\n\n' +
      'Whichever you pick gets less stable the more of this ship is broken,\n' +
      'and steadies as you repair it -- except off and clean, which never\n' +
      'move whatever is happening.',
    plain:
      'Changes how much the screen looks like an old monitor.\n\n' +
      '  crt clean     steady and clear\n' +
      '  crt classic   scanlines and glow\n' +
      '  crt worn      a screen that has been on far too long\n' +
      '  crt off       none of it\n\n' +
      'If flicker bothers you, use  crt clean  or  crt off. Those two never\n' +
      'move, no matter what state the ship is in.',
    run: (_ctx, argv, io) => {
      const wanted = argv[1]?.toLowerCase();
      const current = savedTube ?? DEFAULT_TUBE;

      if (wanted === undefined) {
        io.out(
          [
            '',
            '-- SCREENS -------------------',
            '',
            ...TUBE_NAMES.map((n) => `  ${n === current ? '>' : ' '} ${n}`),
            '',
            view.accelerated
              ? 'Switch with:  crt <name>'
              : 'This device has no WebGL2, so none of these do anything.',
            '',
          ].join('\n') + '\n',
        );
        return 0;
      }

      if (!TUBE_NAMES.includes(wanted as never)) {
        io.err(`crt: no screen called '${wanted}'\nTry one of: ${TUBE_NAMES.join(', ')}\n`);
        return 1;
      }

      try {
        window.localStorage.setItem('sigkill:crt', wanted);
      } catch {
        // Private window. The switch still holds for this session.
      }
      savedTube = wanted;
      refreshTube();
      io.out(`crt: ${wanted}\n`);
      return 0;
    },
  };
}

function soundCommand(): CommandSpec {
  return {
    name: 'sound',
    summary: 'turn the ship audio on or off',
    manual:
      'sound [on|off]\n\n' +
      'With no argument, say whether it is on.\n\n' +
      'Everything you hear is synthesised in the browser -- there are no\n' +
      'audio files, so nothing is downloaded and nothing is tracked. The\n' +
      'room tone is the ship: the reactor is always there, moving air\n' +
      'arrives when the scrubber starts, and a compartment open to vacuum\n' +
      'hisses until you seal it.',
    plain:
      'Turns the sound on or off.\n\n' +
      '  sound off     silence\n' +
      '  sound on      back again\n\n' +
      'What you hear is the ship itself. If something is broken you can hear\n' +
      'that it is broken, and when you fix it the sound changes.',
    run: (_ctx, argv, io) => {
      const wanted = argv[1]?.toLowerCase();
      if (wanted === undefined) {
        io.out(`sound: ${sound.muted ? 'off' : 'on'}\n`);
        return 0;
      }
      if (wanted !== 'on' && wanted !== 'off') {
        io.err(`sound: say 'on' or 'off'\n`);
        return 1;
      }
      const muted = wanted === 'off';
      sound.setMuted(muted);
      try {
        window.localStorage.setItem('sigkill:sound', muted ? 'off' : 'on');
      } catch {
        // Private window. The switch still holds for this session.
      }
      if (!muted) {
        void sound.resume();
        sound.setState(shipSound());
      refreshTube();
      }
      io.out(`sound: ${wanted}\n`);
      return 0;
    },
  };
}

function paletteCommand(): CommandSpec {
  return {
    name: 'palette',
    summary: 'change the colour scheme',
    preformatted: true,
    manual:
      'palette [NAME]\n\n' +
      'With no argument, list the schemes and show which one is on.\n' +
      'With a name, switch to it and remember the choice in this browser.\n\n' +
      'A colour scheme is a thing you judge by looking at it, so this exists\n' +
      'to be flipped back and forth while you decide.',
    plain:
      'Changes the colours.\n\n' +
      '  palette              see the list\n' +
      '  palette warm         switch to the one called warm\n\n' +
      'It remembers what you picked.',
    run: (_ctx, argv, io) => {
      const wanted = argv[1]?.toLowerCase();
      const current = savedPalette ?? DEFAULT_PALETTE;

      if (wanted === undefined) {
        io.out(
          [
            '',
            '-- PALETTES ------------------',
            '',
            ...PALETTE_NAMES.map((n) => `  ${n === current ? '>' : ' '} ${n}`),
            '',
            'Switch with:  palette <name>',
            '',
          ].join('\n') + '\n',
        );
        return 0;
      }

      if (!PALETTE_NAMES.includes(wanted as never)) {
        io.err(`palette: no scheme called '${wanted}'\nTry one of: ${PALETTE_NAMES.join(', ')}\n`);
        return 1;
      }

      try {
        window.localStorage.setItem('sigkill:palette', wanted);
      } catch {
        // Private window. The switch below still works for this session.
      }
      view.setPalette(paletteByName(wanted));
      io.out(`palette: ${wanted}\n`);
      return 0;
    },
  };
}

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
/*
 * The palette is a choice somebody has to make by looking, so it is switchable
 * without a rebuild: `?palette=warm`, or the `palette` command in the shell.
 * The pick is remembered per browser, because comparing two of them means
 * reloading and nobody should lose their run to a colour experiment.
 */
const query = new URLSearchParams(location.search);
let savedTube = ((): string | null => {
  try {
    return query.get('crt') ?? window.localStorage.getItem('sigkill:crt');
  } catch {
    return query.get('crt');
  }
})();

const savedPalette = ((): string | null => {
  try {
    return query.get('palette') ?? window.localStorage.getItem('sigkill:palette');
  } catch {
    // A private window, or site data blocked. A default palette is fine.
    return query.get('palette');
  }
})();

const view = new TerminalView(screen, {
  font: '13.5px "IBM Plex Mono", ui-monospace, "Roboto Mono", Menlo, Consolas, monospace',
  gutter: 16,
  plain: query.has('plain'),
  palette: paletteByName(savedPalette),
  crt: tubeByName(savedTube),
});
/*
 * The ship, sounding. Entirely synthesised -- no audio files, so nothing is
 * fetched and nothing has to be licensed.
 *
 * Muted state is remembered per browser. The context itself cannot start until
 * the player touches something, which every browser enforces and which is the
 * correct default for a page that makes noise.
 */
const sound = new Soundtrack({
  muted: ((): boolean => {
    try {
      return window.localStorage.getItem('sigkill:sound') === 'off';
    } catch {
      return false;
    }
  })(),
});

const input = document.querySelector<HTMLInputElement>('#input')!;
const promptEl = document.querySelector<HTMLLabelElement>('#prompt')!;
const form = document.querySelector<HTMLFormElement>('#line')!;
const chips = document.querySelector<HTMLDivElement>('#chips')!;
const symbols = document.querySelector<HTMLDivElement>('#symbols')!;
const tabButton = document.querySelector<HTMLButtonElement>('#tab')!;
const turnEl = document.querySelector<HTMLElement>('#turn')!;
const turnCmd = document.querySelector<HTMLElement>('#turn-cmd')!;
const turnOut = document.querySelector<HTMLElement>('#turn-out')!;
const foldEl = document.querySelector<HTMLElement>('#fold')!;
const foldBody = document.querySelector<HTMLElement>('#fold-body')!;
const foldNext = document.querySelector<HTMLButtonElement>('#fold-next')!;
const scrollThumb = document.querySelector<HTMLElement>('#scroll-thumb')!;
const scrollRail = document.querySelector<HTMLElement>('#scroll-rail')!;

const history: string[] = saved?.history ?? [];
let historyIndex = history.length;

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

/*
 * The keypress click. Attached to the real input rather than the document so
 * it never fires for a shortcut, and skipped for modifiers and navigation --
 * a click on every arrow key is how a nice sound becomes an irritating one.
 */
input.addEventListener('keydown', (event) => {
  if (event.ctrlKey || event.metaKey || event.altKey) return;
  if (event.key.length !== 1 && event.key !== 'Backspace') return;
  void sound.resume();
  sound.play('key');
});

function refreshPrompt(): void {
  promptEl.textContent = machine.prompt;
}

async function submit(raw: string): Promise<void> {
  const command = raw.trim();
  // Every browser refuses to start an AudioContext outside a gesture, and is
  // right to. This is the first one that reliably happens.
  void sound.resume();
  sound.play('submit');
  const echoed = machine.prompt + command;
  write(echoed, 'echo');

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
          if (segment.preformatted) {
            sound.play('reveal');
            writeArt(segment.text, 'out');
          } else {
            writeBlock(segment.text, 'out');
          }
        }
        writeBlock(result.stderr, 'err');
        if (result.stderr.length > 0) sound.play('error');
      }
      if (result.screen) enterScreen(result.screen);
      machine.tick(1000);
      const lastTurn = {
        command: echoed,
        output: result.segments.map((s) => s.text).join(''),
        error: result.stderr,
      };
      showTurn(lastTurn);
      playBeats();
      checkActComplete();
      persist(lastTurn);
      sound.setState(shipSound());
      refreshTube();
      refreshScrollRail();
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
/**
 * What the ship sounds like, read from the same files everything else reads.
 *
 * No separate audio state to keep in step: if the scrubber is running the room
 * has air in it, and if a compartment is open there is a hiss, because that is
 * what those words mean.
 */
/**
 * Retune the tube to how the ship is doing.
 *
 * The screen is part of the ship. Nothing fixed means a picture that cannot
 * hold still; every repair steadies it. The visual half of what the
 * soundtrack does, and told without a sentence either way.
 */
function refreshTube(): void {
  const rows = questbook.status(machine);
  const done = rows.filter((row) => row.done).length;
  const health = rows.length === 0 ? 1 : done / rows.length;
  view.setCrt(degrade(tubeByName(savedTube), health));
}

function shipSound(): AudioState {
  const open = ['c1', 'c2', 'c3', 'c4', 'c5', 'c6', 'c7', 'c8', 'c9'].some((id) => {
    try {
      return !/^\s*SEALED\s*=\s*yes\s*$/im.test(
        machine.vfs.readText(`/etc/hull/${id}.conf`, machine.shell.user),
      );
    } catch {
      return false;
    }
  });

  const done = questbook.status(machine).filter((row) => row.done).length;
  const total = Math.max(1, questbook.status(machine).length);

  return {
    scrubber: machine.services.get('scrubber')?.state === 'active',
    monitor: machine.services.get('hull-monitor')?.state === 'active',
    breached: open,
    // The reserve is not simulated yet, so progress stands in for it: the room
    // tone eases as the act is put right. Replace this the moment there is a
    // real clock on the oxygen.
    reserve: 0.09 + (done / total) * 0.6,
  };
}

function playBeats(): void {
  let closed = false;
  const spoken: BeatLine[] = [];
  for (const objective of questbook.drainCompleted(machine)) {
    // The hull turning out to be open is the one piece of good news that is
    // also bad news, so it gets the alarm rather than the chime.
    sound.play(objective.id === 'hull-watch' ? 'alarm' : 'resolve');
    spoken.push(...(objective.onComplete ?? []));
    closed = true;
  }
  // Finishing one thing is exactly the moment a player asks "so now what".
  // Answering unprompted is the difference between a board they have to know
  // to ask for and one they cannot miss.
  if (closed && !questbook.complete(machine)) spoken.push(...whatNow(questbook, machine));
  // History still gets the beat — looking back must work — but the player
  // reads it in the fold, so the last command stays on the turn strip.
  if (spoken.length > 0) {
    sayBeat(spoken);
    enqueueFold(spoken);
  }
}

/**
 * Play the act's ending, once.
 *
 * Checked after every command rather than tied to a particular one, because
 * the objectives are solution-agnostic: the player can finish the act with
 * `sed`, with vi, or from Python, and the ending has to land either way.
 */
let actEnded = saved?.actEnded ?? false;
const foldPages: BeatLine[][] = [];

let currentTurn: LastTurn | undefined = saved?.lastTurn;

function persist(lastTurn = currentTurn): void {
  try {
    writeSave({
      version: 1,
      machine: machine.snapshot(),
      quest: questbook.snapshot(),
      actEnded,
      history,
      ...(lastTurn ? { lastTurn } : {}),
    });
  } catch {
    // Private window. The run still holds for this session.
  }
}

function showTurn(turn: LastTurn): void {
  currentTurn = turn;
  turnEl.hidden = false;
  turnCmd.textContent = turn.command;
  const body = turn.error.length > 0 ? turn.error : turn.output;
  turnOut.textContent = body.replace(/\n$/, '');
  turnOut.classList.toggle('err', turn.error.length > 0);
  turnOut.classList.toggle('art', turn.output.includes('\n') && !turn.error);
  turnOut.scrollTop = 0;
}

function refreshScrollRail(): void {
  const max = view.scrollMax;
  if (max === 0) {
    scrollRail.style.visibility = 'hidden';
    return;
  }
  scrollRail.style.visibility = 'visible';
  const track = scrollRail.clientHeight;
  const thumb = Math.max(18, (view.rows / (view.rows + max)) * track);
  const travel = Math.max(0, track - thumb);
  // scroll=0 is pinned to the newest line, so the thumb sits at the bottom.
  const top = travel * (1 - view.scrollRows / max);
  scrollThumb.style.height = `${thumb}px`;
  scrollThumb.style.top = `${top}px`;
}

function showFoldPage(page: readonly BeatLine[]): void {
  foldEl.hidden = false;
  foldBody.textContent = page.map(beatText).join('\n');
  foldBody.classList.toggle('art', pageIsArt(page));
  foldBody.scrollTop = 0;
  foldNext.textContent = foldPages.length > 0 ? 'tap to continue' : 'tap to close';
}

function enqueueFold(lines: readonly BeatLine[]): void {
  const pages = paginateBeats(lines);
  if (pages.length === 0) return;
  foldPages.push(...pages);
  if (foldEl.hidden) {
    const first = foldPages.shift();
    if (first) showFoldPage(first);
  } else {
    foldNext.textContent = 'tap to continue';
  }
}

function advanceFold(): void {
  const next = foldPages.shift();
  if (next) {
    showFoldPage(next);
    return;
  }
  foldEl.hidden = true;
  foldBody.textContent = '';
}

function checkActComplete(): void {
  if (actEnded || !questbook.complete(machine)) return;
  actEnded = true;
  sound.play('act');
  enqueueFold(epilogue(machine));
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
  turnEl.hidden = true;
  foldEl.hidden = true;
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
  if (currentTurn) showTurn(currentTurn);
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
  if (!foldEl.hidden) {
    advanceFold();
    return;
  }
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
    view.scrollBy(Math.sign(event.deltaY));
    refreshScrollRail();
  },
  { passive: false },
);

let touchY: number | null = null;
screen.addEventListener('touchstart', (e) => { touchY = e.touches[0]?.clientY ?? null; }, { passive: true });
screen.addEventListener('touchmove', (e) => {
  const y = e.touches[0]?.clientY;
  if (y === undefined || touchY === null) return;
  const delta = touchY - y;
  const row = Math.max(14, view.rowHeight);
  if (Math.abs(delta) >= row) {
    view.scrollBy(Math.trunc(delta / row));
    touchY = y;
    refreshScrollRail();
  }
}, { passive: true });
screen.addEventListener('touchend', () => { touchY = null; }, { passive: true });

holdFocusOnTap(foldNext);
foldNext.addEventListener('click', () => {
  advanceFold();
  keepFocus();
});

// A rotation or a keyboard appearing changes the grid; the program has to be
// told, or it keeps drawing to the old geometry.
window.addEventListener('resize', () => {
  if (screenProgram) paintScreen();
  refreshScrollRail();
});

/*
 * The host's own commands, registered here rather than beside `bootWreck`
 * because every one of them closes over `view` or `sound`, and those are
 * declared further down. Calling `refreshTube()` up there threw a temporal
 * dead zone error on load and blanked the whole page -- caught by the
 * screenshot harness, which is the argument for keeping that harness.
 */
machine.shell.commands.set('palette', paletteCommand());
machine.shell.commands.set('sound', soundCommand());
machine.shell.commands.set('crt', crtCommand());
machine.shell.commands.set('newgame', newgameCommand());
refreshTube();

if (saved) {
  write('NAV-7 session restored. The ship has not forgotten.', 'system');
  write('Type:  objectives      start over:  newgame', 'system');
  showTurn(
    saved.lastTurn ?? {
      command: 'session restored',
      output: 'Type:  objectives      start over:  newgame',
      error: '',
    },
  );
} else {
  sayBeat(coldOpen(machine));
  enqueueFold(whatNow(questbook, machine));
  sayBeat(whatNow(questbook, machine));
}
refreshPrompt();
buildSymbolRow();
refreshChips();
scrollToEnd();
refreshScrollRail();
input.focus();

// Exported for the console during development.
Object.assign(window, { machine, questbook, vpath, view });
