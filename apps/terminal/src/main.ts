import {
  DEFAULT_PALETTE, DEFAULT_TUBE, degrade, highlight, paletteByName, PALETTE_NAMES,
  TerminalView, tubeByName, TUBE_NAMES,
} from '@sigkill/crt';
import { applyWrite, chipKeystrokes, flushPendingWrite } from '@sigkill/editor';
import { path as vpath, type CommandSpec, type ScreenProgram } from '@sigkill/machine';
import { WorkerPythonRuntime } from '@sigkill/python';
import { WorkerSqlRuntime } from '@sigkill/sql';
import { Soundtrack, type ShipState as AudioState } from '@sigkill/audio';
import { whatNow, type AdventureSession, type BeatLine } from '@sigkill/quest';
import {
  clearSave,
  readLastPlayed,
  readSave,
  savedAdventures,
  writeLastPlayed,
  writeSave,
} from './save.js';
import { statusRows } from './status.js';
import { chooserLines, chosen, entry, offered, LIBRARY, type Entry } from './library.js';

/*
 * The interpreters, built before any adventure is.
 *
 * They used to be attached to the machine after boot, which was fine when the
 * only game was The Wreck -- it reaches for Python long after the cold open, if
 * ever. The Archive builds its own database *at boot*, by running the schema it
 * ships as readable text, so it needs SQLite in its hand before it has a world
 * to put it in.
 *
 * Both are still lazy: constructing them costs nothing, and the worker spawns
 * and the wasm loads on first use and never before. A player still learning
 * `ls` does not pay for an interpreter they have not reached.
 */
const python = new WorkerPythonRuntime({
  indexURL: new URL('pyodide/', document.baseURI).href,
  createWorker: () =>
    new Worker(new URL('./python.worker.ts', import.meta.url), { type: 'module' }),
});

const sql = new WorkerSqlRuntime({
  wasmURL: new URL('sqlite/wa-sqlite.wasm', document.baseURI).href,
  createWorker: () => new Worker(new URL('./sql.worker.ts', import.meta.url), { type: 'module' }),
});

const runtimes = { python, sql };
const library = offered(runtimes);

/*
 * Which adventure, and whether to ask.
 *
 * A returning player goes straight back where they were -- being asked to pick
 * a game every time you open the app is the interface making you do its
 * bookkeeping. Somebody opening it for the first time gets the chooser instead
 * of the cold open, and the first adventure is booted underneath it because
 * that is the answer most of them will give, and booting it now means choosing
 * it costs nothing.
 */
const lastPlayed = readLastPlayed();
let current: Entry = entry(lastPlayed ?? '') ?? library[0]!;
/** True while the chooser owns the next line of input. */
let choosing = lastPlayed === null && library.length > 1;

let saved = readSave(current.adventure.id);

/**
 * Open the run, and survive a save that cannot be opened.
 *
 * A snapshot written by an older build can be structurally valid and still fail
 * to restore, and before this the failure was a blank page -- the module threw
 * at top level and nothing downstream ever ran. A player cannot report that and
 * cannot recover from it either, because the thing that breaks the app is the
 * thing stored in their browser.
 *
 * So: try the saved run, fall back to a fresh one, and say which happened. The
 * old save is left where it is rather than deleted; it is evidence, and the
 * player can wipe it with `newgame` once they are looking at a working screen.
 */
async function openRun(): Promise<{ session: AdventureSession; stale: boolean }> {
  if (saved) {
    try {
      return {
        session: await current.adventure.restore(
          { machine: saved.machine, quest: saved.quest },
          runtimes,
        ),
        stale: false,
      };
    } catch {
      saved = null;
    }
  }
  return { session: await current.adventure.boot(runtimes), stale: true };
}

const opened = await openRun();
const session = opened.session;
/** True when a save existed and could not be restored. Reported after boot. */
const staleSave = opened.stale && readSave(current.adventure.id) !== null;
let machine = session.machine;
let questbook = session.questbook;

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
/** The Machine has no screen, so every command that prints builds its own text. */
const CRLF = '\n';

/** Set by `newgame` so the post-command persist does not write the wipe back. */
let wiping = false;

/**
 * The series, and how to open one.
 *
 * A host command for the same reason `palette` is one: the Machine has no idea
 * there is more than one world, and must not learn. It is also the only thing
 * that makes the other two games reachable for a player who has already chosen
 * once -- the chooser is shown to a new player and then never again, which is
 * right, and would otherwise be a one-way door.
 */
function gamesCommand(): CommandSpec {
  return {
    name: 'games',
    summary: 'list the adventures, and open one',
    manual:
      'games [name]' + CRLF + CRLF +
      'With no argument, list the adventures and which have a run in progress.' + CRLF +
      'With a name or a number, open that one. Each keeps its own save, so' + CRLF +
      'leaving one does not end it.' + CRLF,
    plain:
      'Shows the list of games and lets you switch between them.' + CRLF +
      'Each game remembers where you were, so it is safe to look.' + CRLF,
    run: (_ctx, argv, io) => {
      const rest = argv.slice(1).join(' ').trim();
      if (rest.length === 0) {
        const saved = savedAdventures(library.map((e) => e.adventure.id));
        for (const [index, { adventure }] of library.entries()) {
          const here = adventure.id === current.adventure.id ? '  <- you are here' : '';
          const mark = saved.has(adventure.id) ? ' [in progress]' : '';
          io.out(`  ${index + 1}. ${adventure.title}${mark}${here}` + CRLF);
          io.out(`     ${adventure.teaches}` + CRLF);
        }
        io.out(CRLF + '  games <number>   to open one' + CRLF);
        return 0;
      }

      const picked = chosen(library, rest);
      if (!picked) {
        io.err(`games: no adventure called ${rest}` + CRLF);
        return 1;
      }
      if (picked.adventure.id === current.adventure.id) {
        io.out(`games: you are already in ${picked.adventure.title}.` + CRLF);
        return 0;
      }
      io.out(`games: opening ${picked.adventure.title}. This run is saved.` + CRLF);
      // Persisted by the post-command autosave before the reload lands.
      open_(picked.adventure.id);
      return 0;
    },
  };
}

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
      wiping = true;
      clearSave(current.adventure.id);
      io.out(`newgame: ${current.adventure.title} is forgetting.\n`);
      window.setTimeout(() => window.location.reload(), 80);
      return 0;
    },
  };
}


/**
 * Type size, which on a phone is the only font choice that means anything.
 *
 * Family stacks barely vary -- you get whatever monospace the OS ships -- and
 * fetching one would be the first network request this project has ever made.
 * Size is the real lever, so it is the one that is offered.
 */
function fontCommand(): CommandSpec {
  return {
    name: 'font',
    summary: 'change the type size',
    manual:
      'font [SIZE|bigger|smaller|auto]\n\n' +
      'With no argument, say what size the type is and how wide the screen is\n' +
      'in columns.\n\n' +
      '  font 18       set it, and remember it in this browser\n' +
      '  font bigger   two points up;  font smaller  two points down\n' +
      '  font auto     size it to the window again\n\n' +
      'auto is the default and fits the written column width across the\n' +
      'screen, which is why the same game is readable on a phone and on a\n' +
      'monitor. No font is downloaded; the face is bundled.',
    plain:
      'Makes the text bigger or smaller.\n\n' +
      '  font bigger\n' +
      '  font smaller\n' +
      '  font auto     let it choose\n\n' +
      'It remembers what you picked.',
    run: (_ctx, argv, io) => {
      const wanted = argv[1]?.toLowerCase();
      const current = fontPx ?? autoFontPx();

      if (wanted === undefined) {
        io.out(
          `font: ${current.toFixed(1)}px ${fontPx === null ? '(auto)' : '(set)'}, ` +
            `${view.columns} columns\n`,
        );
        return 0;
      }

      let next: number | null;
      if (wanted === 'auto') next = null;
      else if (wanted === 'bigger') next = Math.min(48, current + 2);
      else if (wanted === 'smaller') next = Math.max(8, current - 2);
      else {
        const value = Number(wanted);
        if (!Number.isFinite(value) || value < 8 || value > 48) {
          io.err(`font: size must be a number between 8 and 48, or bigger/smaller/auto\n`);
          return 1;
        }
        next = value;
      }

      fontPx = next;
      try {
        if (next === null) window.localStorage.removeItem('sigkill:font');
        else window.localStorage.setItem('sigkill:font', String(next));
      } catch {
        // Private window. The choice holds for this session.
      }
      view.setFont(fontSpec());
      refreshStatus();
      io.out(`font: ${(fontPx ?? autoFontPx()).toFixed(1)}px, ${view.columns} columns\n`);
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
      '  worn      a tube that has had a hard life\n' +
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

/*
 * Both interpreters, on every adventure's machine.
 *
 * An adventure that declared what it needs already had it passed in at boot;
 * this makes the other one available too, because `python3` and `sqlite3` are
 * things the ship has rather than things the story hands out. A player who
 * wants to check an archive figure with Python should be able to.
 */
machine.python = python;
machine.sql = sql;

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

const FACE = '"IBM Plex Mono", ui-monospace, "Roboto Mono", Menlo, Consolas, monospace';

/**
 * The type size this screen should use, in CSS pixels.
 *
 * Every beat in this game is hard-wrapped in the content -- `'ORACLE: ...'`
 * lines are authored one screen-line at a time, for a phone. So the column
 * count is fixed by the writing at somewhere around sixty-six, and a desktop
 * showing them at a phone's type size is a sixty-column game sitting in a
 * two-hundred-column window with the right two thirds empty. It looked like a
 * layout bug and it was really a scaling one.
 *
 * So the cell grows instead: pick the size that lands the authored width
 * across the real screen. Clamped at both ends -- never smaller than a phone
 * needs, never so large that a maximised window shows six words a line.
 */
const TARGET_COLS = 104;
const MIN_PX = 13.5;
const MAX_PX = 21;

function autoFontPx(): number {
  // The 0.6 is the width-to-size ratio of a monospace cell; Plex Mono is
  // 0.6 exactly, which is why the guess does not need measuring.
  const usable = Math.max(240, (window.visualViewport?.width ?? window.innerWidth) - 48);
  return Math.min(MAX_PX, Math.max(MIN_PX, usable / TARGET_COLS / 0.6));
}

/** A size the player chose, if they chose one. `auto` clears it. */
let fontPx: number | null = ((): number | null => {
  const asked = query.get('font');
  const stored = (() => {
    try {
      return window.localStorage.getItem('sigkill:font');
    } catch {
      return null;
    }
  })();
  const value = Number(asked ?? stored);
  return Number.isFinite(value) && value >= 8 && value <= 48 ? value : null;
})();

const fontSpec = (): string => `${(fontPx ?? autoFontPx()).toFixed(1)}px ${FACE}`;

const view = new TerminalView(screen, {
  font: fontSpec(),
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
const dock = document.querySelector<HTMLDivElement>('#dock')!;
const chips = document.querySelector<HTMLDivElement>('#chips')!;
const symbols = document.querySelector<HTMLDivElement>('#symbols')!;
const tabButton = document.querySelector<HTMLButtonElement>('#tab')!;
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

/**
 * Show the series and wait for a number.
 *
 * Written to the terminal rather than built as a screen of its own, because the
 * terminal is the interface and a chooser that needed its own keyboard handling
 * would be a second input model to keep working on a phone -- and Phase 2 was
 * gated on exactly one of those being pleasant.
 */
function showChooser(): void {
  for (const line of chooserLines(library, savedAdventures(library.map((e) => e.adventure.id)))) {
    write(line, 'system');
  }
}

/**
 * Open an adventure, from the chooser or from `play`.
 *
 * Reloads rather than swapping the world in place. Every closure in this file
 * has captured `machine`, the mixer holds a room tone, the view holds a
 * scrollback, and a save belongs to one adventure -- rebuilding all of that
 * correctly in place is a great deal of work to save a player one second, and
 * the one place it could go wrong is somebody's run in progress.
 *
 * `newgame` has always done it this way and it has never been the thing anybody
 * complained about.
 */
function open_(id: string): void {
  writeLastPlayed(id);
  window.setTimeout(() => window.location.reload(), 80);
}

async function submit(raw: string): Promise<void> {
  const command = raw.trim();
  // Every browser refuses to start an AudioContext outside a gesture, and is
  // right to. This is the first one that reliably happens.
  void sound.resume();
  sound.play('submit');
  const echoed = machine.prompt + command;
  write(echoed, 'echo');

  /*
   * The chooser owns exactly one line of input, and only for a brand-new
   * player.
   *
   * It runs here rather than in its own input mode so that scrolling, the soft
   * keyboard, the symbol row and history all keep working without knowing the
   * chooser exists.
   */
  if (choosing) {
    const picked = chosen(library, command);
    if (!picked) {
      write(`Not one of them. Type 1-${library.length}.`, 'err');
      refreshPrompt();
      return;
    }
    choosing = false;
    if (picked.adventure.id === current.adventure.id) {
      // Already booted underneath the chooser, which is why this is free.
      sayBeat([...current.adventure.coldOpen(machine), ...whatNow(questbook, machine)]);
      writeLastPlayed(current.adventure.id);
      refreshStatus();
      sound.setState(shipSound());
      refreshPrompt();
      return;
    }
    write(`Opening ${picked.adventure.title}...`, 'system');
    open_(picked.adventure.id);
    return;
  }

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
      playBeats();
      checkActComplete();
      persist();
      sound.setState(shipSound());
      refreshTube();
      refreshStatus();
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

/** The nine compartments of deck C, named once. */
const COMPARTMENTS = ['c1', 'c2', 'c3', 'c4', 'c5', 'c6', 'c7', 'c8', 'c9'] as const;

/**
 * The readout, built from the same files and the same process table that
 * `deck`, `pressure` and `objectives` read.
 *
 * No parallel state to keep in step. If the scrubber is running there is air,
 * if a compartment says SEALED=no there is a hole, and if the questbook says
 * you are on a step then that is what you are doing.
 */
function refreshStatus(): void {
  /*
   * Nothing, while the player is still choosing.
   *
   * The first adventure is booted underneath the chooser so that picking it
   * costs nothing -- but that means its air, its hull and its progress are all
   * sitting in a machine nobody has agreed to play yet, and the readout was
   * happily drawing them above a list of three games. Found by the e2e harness,
   * which is the second time it has caught something a unit test could not see.
   */
  if (choosing) {
    view.setStatus([]);
    return;
  }

  const rows = questbook.status(machine);
  const objective = questbook.current(machine);
  view.setStatus(
    statusRows(
      {
        ...current.hooks.readout?.(machine),
        // The spine only, matching the board. An optional thread that is not
        // going to hold the act open must not sit in the progress count
        // looking like something the player has failed to finish.
        done: rows.filter((row) => !row.optional && row.done).length,
        goals: rows.filter((row) => !row.optional).length,
        // The step, or the objective it belongs to. Undefined means finished,
        // and saying "act one complete" while something is still open would
        // be the readout lying, which is the one thing it must never do.
        ...(objective
          ? { step: questbook.step(machine, objective)?.label ?? objective.title }
          : { step: undefined }),
      },
      view.columns,
    ),
  );
}

function shipSound(): AudioState {
  // The spine only, matching the board and the readout. Counting the optional
  // threads here would ease the room tone for reading a file, and would mean
  // a player who skips them never hears the ship fully settle.
  const spine = questbook.status(machine).filter((row) => !row.optional);
  const done = spine.filter((row) => row.done).length;
  const total = Math.max(1, spine.length);

  // An adventure with no ship to listen to gets a quiet room, which is the
  // honest sound for one whose tone has not been authored.
  return current.hooks.sound?.(machine, { done, goals: total }) ?? SILENT;
}

/*
 * The room for an adventure with no authored tone.
 *
 * Silence rather than a guess. Two of the three games open on somebody else's
 * terminal in a building with people in it, and a reactor hum under that would
 * be the mixer inventing a ship that is not there.
 */
const SILENT: AudioState = { scrubber: false, monitor: false, breached: false, reserve: 1 };

function playBeats(): void {
  let closed = false;
  const spoken: BeatLine[] = [];
  for (const objective of questbook.drainCompleted(machine)) {
    // The hull turning out to be open is the one piece of good news that is
    // also bad news, so it gets the alarm rather than the chime.
    sound.play(objective.id === 'hull-watch' ? 'alarm' : 'resolve');
    spoken.push(...questbook.beat(objective, machine));
    closed = true;
  }
  /*
   * And whatever the world itself has to say.
   *
   * After the objective beats, because a companion arriving is a reaction to
   * the thing that just closed and reads wrong ahead of it -- and before the
   * "so now what", which has to be the last thing on the screen or it is not
   * doing its job. Runs on every command, not only the ones that finish
   * something: she answers a signal that was sent in the middle of one.
   */
  spoken.push(...(session.afterCommand?.() ?? []));

  // Finishing one thing is exactly the moment a player asks "so now what".
  // Answering unprompted is the difference between a board they have to know
  // to ask for and one they cannot miss.
  if (closed && !questbook.complete(machine)) spoken.push(...whatNow(questbook, machine));

  if (spoken.length > 0) {
    sayBeat(spoken);
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
function persist(): void {
  if (wiping) return;
  try {
    writeSave(current.adventure.id, {
      version: 1,
      machine: machine.snapshot(),
      quest: questbook.snapshot(),
      actEnded,
      history,
    });
  } catch {
    // Private window. The run still holds for this session.
  }
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

function checkActComplete(): void {
  if (actEnded || !questbook.complete(machine)) return;
  actEnded = true;
  sound.play('act');
  sayBeat(current.adventure.epilogue(machine));
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

/*
 * Scrolling the canvas is ours to implement: it is a picture, not a document.
 */
function bindSurface(surface: HTMLElement): void {
  surface.addEventListener('click', () => {
    if (window.getSelection()?.toString()) return;
    if (!input.disabled) input.focus();
  });

  surface.addEventListener(
    'wheel',
    (event) => {
      event.preventDefault();
      // Wheel down means further down the page, which is towards the newest.
      view.scrollBy(-Math.sign(event.deltaY));
      refreshScrollRail();
    },
    { passive: false },
  );

  let touchY: number | null = null;
  let touchRows = 0;

  surface.addEventListener('touchstart', (e) => {
    touchY = e.touches[0]?.clientY ?? null;
    touchRows = 0;
  }, { passive: true });

  surface.addEventListener('touchmove', (e) => {
    const y = e.touches[0]?.clientY;
    if (y === undefined || touchY === null) return;

    // The content follows the thumb: drag down and what was above comes into
    // view, which is further back.
    touchRows += (y - touchY) / Math.max(14, view.rowHeight);
    touchY = y;

    const whole = Math.trunc(touchRows);
    if (whole === 0) return;
    touchRows -= whole;
    view.scrollBy(whole);
    refreshScrollRail();
  }, { passive: true });

  surface.addEventListener('touchend', () => { touchY = null; touchRows = 0; }, { passive: true });
}

bindSurface(screen);

/*
 * How much of the page the player can actually see.
 *
 * `100dvh` is the whole screen whether or not a keyboard is sitting on top of
 * it, and on a phone that is most of the screen. Terminal and controls are
 * sized off `--app-height` plus a measured dock reserve so the last rows stay
 * readable while typing.
 *
 * `visualViewport` is the only thing that knows this. Where it is missing the
 * CSS fallback stands, which is the old behaviour and no worse.
 */
/** The tallest this viewport has been at its current width. */
let tallest = 0;
let lastWidth = 0;
/** The width the auto type size was last computed for. */
let lastFontWidth = 0;

function syncViewport(): void {
  const vv = window.visualViewport;
  const width = vv?.width ?? window.innerWidth;
  const height = vv?.height ?? window.innerHeight;

  // A rotation is a different screen, not a shorter one.
  if (width !== lastWidth) {
    lastWidth = width;
    tallest = 0;
  }
  tallest = Math.max(tallest, height);

  document.documentElement.style.setProperty('--app-height', `${Math.round(height)}px`);

  // Auto type size follows the window. A size the player chose does not: they
  // chose it, and having it silently move on rotate would be the app arguing.
  if (fontPx === null && width !== lastFontWidth) {
    lastFontWidth = width;
    view.setFont(fontSpec());
  }

  /*
   * Measured against the tallest this screen has been rather than against
   * `innerHeight`, because the two ways a browser can handle a soft keyboard
   * need different sums: Android with `interactive-widget=resizes-content`
   * shortens the layout viewport too, so the difference between them is zero
   * and a keyboard would never be noticed. What both have in common is that
   * the screen got shorter than it was.
   */
  document.documentElement.classList.toggle('keyboard', height < tallest * 0.8);

  // Keep the bottom rows visible: the stage ends above the live dock height.
  const reserve = Math.ceil(dock.getBoundingClientRect().height + 12);
  document.documentElement.style.setProperty('--dock-reserve', `${reserve}px`);

  // iOS scrolls the *layout* viewport under the keyboard rather than
  // shortening it, which walks the dock off the bottom of the screen. There
  // is nothing on this page to scroll, so putting it back is safe and is what
  // keeps the input where the player left it.
  if ((vv?.offsetTop ?? 0) > 0 || window.scrollY > 0) window.scrollTo(0, 0);

  if (screenProgram) paintScreen();
  // The readout is clipped to the column count, so a rotation changes what
  // fits on it.
  refreshStatus();
  refreshScrollRail();
}

window.addEventListener('resize', syncViewport);
window.addEventListener('orientationchange', syncViewport);
window.visualViewport?.addEventListener('resize', syncViewport);
window.visualViewport?.addEventListener('scroll', syncViewport);
syncViewport();

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
machine.shell.commands.set('games', gamesCommand());
machine.shell.commands.set('font', fontCommand());
refreshTube();
refreshStatus();

/*
 * Tell the mixer what the ship is doing before anybody touches the page.
 *
 * It cannot make a sound yet -- no browser will start an AudioContext outside
 * a gesture -- but `resume()` applies whatever state it is holding, and
 * without this that state is `SILENT_SHIP`. So the reactor, the open
 * compartment and the stopped scrubber all arrived a command late: the cold
 * open played into silence, and `newgame` reloaded into silence, which is
 * what made it look broken rather than quiet.
 *
 * Now the first keystroke resumes into the real room.
 */
sound.setState(shipSound());

if (choosing) {
  // A brand-new player picks first. The first adventure is already booted
  // underneath this, so choosing it costs nothing and choosing another reloads.
  showChooser();
} else if (staleSave) {
  write(`${current.adventure.title}: the saved run could not be opened.`, 'err');
  write('It was left where it is. Type  newgame  to start clean.', 'system');
  const opening = [...current.adventure.coldOpen(machine), ...whatNow(questbook, machine)];
  sayBeat(opening);
} else if (saved) {
  write(`${current.adventure.title}: session restored.`, 'system');
  write('Type:  objectives      other games:  games      start over:  newgame', 'system');
} else {
  writeLastPlayed(current.adventure.id);
  const opening = [...current.adventure.coldOpen(machine), ...whatNow(questbook, machine)];
  sayBeat(opening);
}
refreshPrompt();
buildSymbolRow();
refreshChips();
scrollToEnd();
refreshScrollRail();
// Again after the first frame: the view measures its grid from a
// ResizeObserver, so the rail drawn during boot is sized off a guess and sits
// in the wrong place until something else happens to refresh it.
requestAnimationFrame(() => refreshScrollRail());
input.focus();

// Exported for the console during development.
Object.assign(window, { machine, questbook, vpath, view, sound });
