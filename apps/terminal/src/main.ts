import {
  DEFAULT_PALETTE, DEFAULT_TUBE, degrade, highlight, paletteByName, PALETTE_NAMES,
  TerminalView, tubeByName, TUBE_NAMES,
} from '@sigkill/crt';
import { applyWrite, chipKeystrokes, flushPendingWrite } from '@sigkill/editor';
import { path as vpath, type CommandSpec, type ScreenProgram } from '@sigkill/machine';
import { WorkerPythonRuntime } from '@sigkill/python';
import { Soundtrack, type ShipState as AudioState } from '@sigkill/audio';
import { whatNow, type BeatLine } from '@sigkill/quest';
import {
  bootWreck, restoreWreck, coldOpen, epilogue, oxygenTarget, readCompartment, ventingCompartments,
} from '@sigkill/wreck';
import { clearSave, readSave, writeSave, type LastTurn } from './save.js';
import { statusRows } from './status.js';
import { beatText, pageIsArt, paginateBeats } from './turn.js';
import { isSpeed, SPEEDS, SPEED_NAMES, Typist, type TypingSpeed } from './typist.js';

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
/** Set by `newgame` so the post-command persist does not write the wipe back. */
let wiping = false;

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
      clearSave();
      io.out('newgame: the ship is forgetting.\n');
      window.setTimeout(() => window.location.reload(), 80);
      return 0;
    },
  };
}

/**
 * How fast the ship talks.
 *
 * A host command for the same reason `palette` and `sound` are: the Machine
 * has no screen, no speakers and no sense of time passing. The right speed is
 * a matter of taste, and taste is not something to guess on somebody's behalf.
 */
function typingCommand(): CommandSpec {
  return {
    name: 'typing',
    summary: 'how fast the ship types at you',
    preformatted: true,
    manual:
      'typing [SPEED]\n\n' +
      `Speeds: ${SPEED_NAMES.join(', ')}. Without an argument, lists them and\n` +
      'says which is on. Remembered in this browser.\n\n' +
      'off reveals every beat whole. It is also what you get automatically if\n' +
      'your system asks for reduced motion.',
    plain:
      'Changes how fast text appears when the ship is talking to you.\n\n' +
      `    typing            what it is now\n` +
      `    typing fast       hurry up\n` +
      `    typing off        no typing at all\n\n` +
      'Tapping the beat always skips straight to the end of the page.',
    run: (_ctx, argv, io) => {
      const wanted = argv[1];
      if (wanted === undefined) {
        io.out(
          [
            'typing speed',
            '',
            ...SPEED_NAMES.map((name) => `  ${name === typingSpeed ? '>' : ' '} ${name}`),
            '',
            'Change it with:  typing <name>',
            '',
          ].join('\n'),
        );
        return 0;
      }
      if (!isSpeed(wanted)) {
        io.err(`typing: no such speed '${wanted}'. Try: ${SPEED_NAMES.join(', ')}\n`);
        return 1;
      }
      typingSpeed = wanted;
      try {
        window.localStorage.setItem('sigkill:typing', wanted);
      } catch {
        // A private window. The choice holds for this session.
      }
      io.out(`typing: ${wanted}\n`);
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

/**
 * The typing speed, from the URL, then the browser, then reduced motion.
 *
 * Reduced motion is not a preference to be talked out of. A player whose
 * system asks for it gets `off` unless they have said otherwise here, and
 * every beat still arrives complete -- nothing is hidden behind the animation,
 * which is the only reason it is safe to have one.
 */
let typingSpeed: TypingSpeed = ((): TypingSpeed => {
  const asked = query.get('typing');
  if (isSpeed(asked)) return asked;
  try {
    const stored = window.localStorage.getItem('sigkill:typing');
    if (isSpeed(stored)) return stored;
  } catch {
    // Site data blocked. Fall through to the default.
  }
  try {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return 'off';
  } catch {
    // No matchMedia. Assume motion is fine.
  }
  return 'normal';
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
      const lastTurn: LastTurn = {
        command: echoed,
        output: result.segments.map((s) => s.text).join(''),
        error: result.stderr,
        // The Machine already knows: `deck` and `pressure` declare themselves
        // preformatted and `cat` does not.
        art: result.segments.some((segment) => segment.preformatted),
      };
      showTurn(lastTurn);
      playBeats();
      checkActComplete();
      persist(lastTurn);
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
  const rows = questbook.status(machine);
  const objective = questbook.current(machine);
  view.setStatus(
    statusRows(
      {
        target: oxygenTarget(machine),
        scrubber: machine.services.get('scrubber')?.state === 'active',
        sealed: COMPARTMENTS.filter((id) => readCompartment(machine.vfs, id).sealed).length,
        compartments: COMPARTMENTS.length,
        venting: ventingCompartments(machine).length,
        done: rows.filter((row) => row.done).length,
        goals: rows.length,
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
  const open = COMPARTMENTS.some((id) => !readCompartment(machine.vfs, id).sealed);

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
  /*
   * And whatever the world itself has to say.
   *
   * After the objective beats, because a companion arriving is a reaction to
   * the thing that just closed and reads wrong ahead of it -- and before the
   * "so now what", which has to be the last thing on the screen or it is not
   * doing its job. Runs on every command, not only the ones that finish
   * something: she answers a signal that was sent in the middle of one.
   */
  spoken.push(...session.afterCommand());

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
  if (wiping) return;
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
  turnOut.classList.toggle('art', turn.art === true && turn.error.length === 0);
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

/**
 * The page currently being typed out, if one is.
 *
 * Nothing is hidden behind the animation: the whole page is already decided
 * when typing starts, a tap reveals it, and `typing off` never starts one.
 * That is what makes it safe to have -- an effect that can withhold
 * information is not an effect, it is a gate.
 */
let typist: Typist | undefined;
let typingFrame = 0;
let typedLines = 0;
let lastTypedAt = 0;

function stopTyping(): void {
  if (typingFrame !== 0) cancelAnimationFrame(typingFrame);
  typingFrame = 0;
  typist = undefined;
}

function typeFrame(now: number): void {
  const current = typist;
  if (!current) return;
  // Clamped: a backgrounded tab resumes with a huge gap, which would
  // otherwise dump the rest of the page in one step.
  const elapsed = lastTypedAt === 0 ? 16.7 : Math.min(now - lastTypedAt, 100);
  lastTypedAt = now;

  const visible = current.advance(elapsed);
  // A block at the end, because that is what a terminal that is still typing
  // looks like and there is no other way to tell it apart from one that has
  // stopped.
  foldBody.textContent = current.done ? visible : `${visible}▋`;

  // One tick per line, not per character. A click on every letter is how a
  // good sound becomes the reason somebody turns the sound off.
  if (current.lines > typedLines) {
    typedLines = current.lines;
    sound.play('key');
  }

  if (current.done) { stopTyping(); return; }
  typingFrame = requestAnimationFrame(typeFrame);
}

function startTyping(text: string, instant: boolean): void {
  stopTyping();
  // Art is revealed whole. A drawing typed one character at a time is a
  // drawing you watch being assembled wrongly for two seconds.
  if (instant || typingSpeed === 'off') {
    foldBody.textContent = text;
    return;
  }
  typist = new Typist(text, SPEEDS[typingSpeed]);
  typedLines = 0;
  lastTypedAt = 0;
  foldBody.textContent = '';
  typingFrame = requestAnimationFrame(typeFrame);
}

/** A tap while the page is still arriving finishes it instead of advancing. */
function skipTyping(): boolean {
  const current = typist;
  if (!current) return false;
  const text = current.finish();
  stopTyping();
  foldBody.textContent = text;
  return true;
}

function showFoldPage(page: readonly BeatLine[]): void {
  // The fold is the thing being read. Stacking it on the last-turn strip
  // ate the CRT on a phone (two 34vh panels). The dock stays; the strip
  // comes back when the fold closes.
  turnEl.hidden = true;
  foldEl.hidden = false;
  foldBody.classList.toggle('art', pageIsArt(page));
  foldBody.scrollTop = 0;
  startTyping(page.map(beatText).join('\n'), pageIsArt(page));
  foldNext.textContent = foldPages.length > 0 ? 'tap to continue' : 'tap to close';
}

/**
 * How many lines fit in the fold right now.
 *
 * Measured rather than assumed, because the room it has depends on the phone,
 * the rotation and whether the keyboard is up -- and a fixed seven turned the
 * opening into ten taps on a screen with space for three.
 */
function foldPageSize(): number {
  const style = window.getComputedStyle(foldBody);
  const line = parseFloat(style.lineHeight) || parseFloat(style.fontSize) * 1.4 || 18;
  const room = foldBody.getBoundingClientRect().height
    || parseFloat(style.maxHeight)
    || window.innerHeight * 0.4;
  return Math.min(24, Math.max(5, Math.floor(room / line)));
}

function enqueueFold(lines: readonly BeatLine[]): void {
  const pages = paginateBeats(lines, foldPageSize());
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
  // First tap lands the page, second tap turns it. Anything else makes a
  // reader feel they have to wait before they are allowed to read.
  if (skipTyping()) return;
  const next = foldPages.shift();
  if (next) {
    showFoldPage(next);
    return;
  }
  stopTyping();
  foldEl.hidden = true;
  foldBody.textContent = '';
  if (currentTurn) showTurn(currentTurn);
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
  if (screenProgram || busy) return;
  const value = input.value;
  // Empty Enter pages the fold. A typed command is a command — the fold
  // yields. On a phone the send key is how you run, and the cold-open
  // nudge must not eat the first `ls`.
  if (!foldEl.hidden && value.trim().length === 0) {
    advanceFold();
    return;
  }
  if (!foldEl.hidden) {
    stopTyping();
    foldPages.length = 0;
    foldEl.hidden = true;
    foldBody.textContent = '';
  }
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

/*
 * Scrolling the canvas is ours to implement: it is a picture, not a document.
 *
 * `view.scroll` counts rows *back* from the newest line, so both of these
 * have to invert. They did not, and the result was a terminal that went the
 * wrong way under your thumb -- drag down and it ran to the bottom, wheel
 * down and it climbed. Going back is up, in both directions, the way it is in
 * every other scrolling thing anybody has ever touched.
 */
screen.addEventListener(
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
/** Sub-row drag, kept so a slow thumb still moves the screen. */
let touchRows = 0;

screen.addEventListener('touchstart', (e) => {
  touchY = e.touches[0]?.clientY ?? null;
  touchRows = 0;
}, { passive: true });

screen.addEventListener('touchmove', (e) => {
  const y = e.touches[0]?.clientY;
  if (y === undefined || touchY === null) return;

  // The content follows the thumb: drag down and what was above comes into
  // view, which is further back. Accumulated in fractions of a row rather
  // than thrown away below the threshold, so a slow drag is smooth instead of
  // being ignored until it jumps.
  touchRows += (y - touchY) / Math.max(14, view.rowHeight);
  touchY = y;

  const whole = Math.trunc(touchRows);
  if (whole === 0) return;
  touchRows -= whole;
  view.scrollBy(whole);
  refreshScrollRail();
}, { passive: true });

screen.addEventListener('touchend', () => { touchY = null; touchRows = 0; }, { passive: true });

holdFocusOnTap(foldNext);
foldNext.addEventListener('click', () => {
  advanceFold();
  keepFocus();
});

/*
 * The whole panel turns the page, not just the button.
 *
 * On a phone the button is a thumb-width target in the middle of a screen the
 * player is already tapping; the panel is the size of the thing they are
 * reading. Selecting text is the one gesture that must not count as a tap,
 * because copying a path out of a beat is a thing people do.
 */
holdFocusOnTap(foldEl);
foldEl.addEventListener('click', (event) => {
  if (event.target === foldNext) return;
  if (window.getSelection()?.toString()) return;
  advanceFold();
  keepFocus();
});

/*
 * How much of the page the player can actually see.
 *
 * `100dvh` is the whole screen whether or not a keyboard is sitting on top of
 * it, and on a phone that is most of the screen. Every panel is sized off
 * `--app-height` instead, so the last-turn strip and the fold give their room
 * back the moment the keyboard arrives rather than holding a third of a
 * screen the player cannot see.
 *
 * `visualViewport` is the only thing that knows this. Where it is missing the
 * CSS fallback stands, which is the old behaviour and no worse.
 */
/** The tallest this viewport has been at its current width. */
let tallest = 0;
let lastWidth = 0;

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

  /*
   * Measured against the tallest this screen has been rather than against
   * `innerHeight`, because the two ways a browser can handle a soft keyboard
   * need different sums: Android with `interactive-widget=resizes-content`
   * shortens the layout viewport too, so the difference between them is zero
   * and a keyboard would never be noticed. What both have in common is that
   * the screen got shorter than it was.
   */
  document.documentElement.classList.toggle('keyboard', height < tallest * 0.8);

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
machine.shell.commands.set('typing', typingCommand());
refreshTube();
refreshStatus();

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
  /*
   * The opening pages through the fold, typed, rather than landing in the
   * scrollback as a wall.
   *
   * It was going straight onto the CRT, which meant the first thing a new
   * player had to do was scroll back up a screen and a half to find out where
   * they were -- on a phone, with the keyboard covering half of it. The
   * scrollback still gets every line, because looking back has to work; the
   * fold is how it is read the first time.
   */
  const opening = [...coldOpen(machine), ...whatNow(questbook, machine)];
  sayBeat(opening);
  enqueueFold(opening);
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
Object.assign(window, { machine, questbook, vpath, view });
