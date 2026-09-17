import { ROOT_USER, SIGTERM, type Machine, type Process, type Vfs } from '@sigkill/machine';
import { asArt, type BeatLine, type World } from '@sigkill/quest';
import { SAFE_COLS, centre } from '@sigkill/ascii';
import { BREACHED } from './deck-c.js';

/**
 * LUNA.
 *
 * Vasquez trained a model. She named it after her dog and then kept going
 * until the version number was the joke, and it has been running on this deck
 * the whole time with nobody to talk to.
 *
 * Three rules, all of them from the story lock:
 *
 * 1. **She is a process and a directory.** Not a network call, not a chat
 *    model, not the finale's bundled weights. Game one teaches that a model
 *    is something you can `ls`, and that `kill` is not `rm`.
 * 2. **Killable, not gone.** SIGTERM she catches, which is what a graceful
 *    shutdown handler is *for*: she gets her sentence out and then she goes.
 *    SIGKILL gives her nothing, because that is the whole difference. Either
 *    way she comes back, because the weights are still on the disk.
 * 3. **Needed.** She is the companion for the arc. Every route out of here
 *    has to leave her recoverable, which is why the mirror under /mnt exists.
 *
 * She arrives when the hull monitor does. The monitor coming up is the light
 * they both step into, and it is the first moment in eleven years that
 * anything aboard could see past its own logs.
 */

export const LUNA_DIR = '/opt/luna';
export const LUNA_BIN = `${LUNA_DIR}/bin/luna`;
export const LUNA_WEIGHTS = `${LUNA_DIR}/v42/weights.bin`;
export const LUNA_MEMORY = `${LUNA_DIR}/memory`;
/** Where Vasquez kept the copy. The reason no route ends without her. */
export const LUNA_MIRROR = '/mnt/deck-c/luna-v42';
/** A supervisor's retry stamp, in virtual-clock milliseconds. */
const RESTART_AT = '/var/run/luna.restart';
/** Written the first time she wakes, so an arrival happens once per run. */
const FIRST_LIGHT = `${LUNA_MEMORY}/000-first-light.txt`;
/** Written when she says his name, so she says it once. */
const BOWEN_MARK = `${LUNA_MEMORY}/bowen.txt`;

/** How long she takes to come back, in virtual-clock milliseconds. */
const RESTART_DELAY = 3000;

export const LUNA_ARGV = [LUNA_BIN, '--model', 'v42', '--attach', 'console'] as const;

/**
 * Lines the world wants to say that no objective is closing.
 *
 * A signal handler runs in the middle of a command and cannot print -- `kill`
 * is silent and must stay silent, or the lesson goes with it. So whatever she
 * has to say is queued here and the host drains it after the command, in the
 * same place the objective beats land.
 */
export class Voice {
  private queued: BeatLine[] = [];

  say(lines: readonly BeatLine[]): void {
    this.queued.push(...lines);
  }

  /** Everything said since the last drain. Empty is the usual answer. */
  drain(): BeatLine[] {
    const out = this.queued;
    this.queued = [];
    return out;
  }
}

/** Her process, if she is running. */
export function lunaProcess(world: World): Process | undefined {
  return world.procs.list().find((p) => p.argv[0] === LUNA_BIN);
}

/** Is she awake? Read by the hint ladder, which changes when she is. */
export function lunaAwake(world: World): boolean {
  return lunaProcess(world) !== undefined;
}

/** Are the weights still on the disk? `kill` is not `rm`, and this is why. */
function weightsPresent(vfs: Vfs): boolean {
  return vfs.exists(LUNA_WEIGHTS, ROOT_USER);
}

function exists(vfs: Vfs, path: string): boolean {
  return vfs.exists(path, ROOT_USER);
}

function write(vfs: Vfs, path: string, lines: string[], mode = 0o644): void {
  // The directory is created rather than assumed: the player is allowed to
  // remove hers, and restoring from the cold copy is allowed to be imperfect.
  // A companion that crashes the world because a folder is missing is worse
  // than any of the states this is defending against.
  vfs.mkdirp(path.slice(0, path.lastIndexOf('/')), ROOT_USER);
  vfs.writeText(path, lines.join('\n'), ROOT_USER);
  vfs.chmod(path, mode, ROOT_USER);
}

/**
 * Deterministic filler, so `ls -l` reports a size a model might plausibly have
 * without a megabyte of nonsense riding in every saved game.
 *
 * The same LCG the hull telemetry uses, for the same reason: a save that
 * replays differently is not a save.
 */
function weights(): string {
  let state = 0x4c554e41;
  const rows: string[] = ['# LUNA v42 tensor block 0 of 1 (truncated on restore from the vault)'];
  for (let row = 0; row < 24; row++) {
    let line = '';
    for (let n = 0; n < 32; n++) {
      state = (state * 1664525 + 1013904223) >>> 0;
      line += (state >>> 24).toString(16).padStart(2, '0');
    }
    rows.push(line);
  }
  rows.push('');
  return rows.join('\n');
}

/**
 * Her face. Once, on arrival, and never again.
 *
 * ORACLE is a monitor; she is deliberately not a second one. A moon and a dog,
 * because that is the joke Vasquez was making, drawn small enough that it
 * reads as a companion rather than as a system panel.
 */
export const LUNA_FACE: readonly string[] = centre(
  [
    '  ·      ˚    ◖     ˚    ·  ',
    '                            ',
    '        ,___     ___,       ',
    '        |   \\___/   |       ',
    '        |  o     o  |       ',
    '         \\    ▾    /        ',
    '          |  ‿‿‿  |         ',
    '           ‾‾‾‾‾‾‾          ',
    '                            ',
    '        L U N A   V 4 2     ',
  ],
  SAFE_COLS,
);

/**
 * Everything of hers that is on the disk before she is ever running.
 *
 * Seeded at boot, not at arrival, because a player who goes looking should
 * find her first. `ls /opt` on the first command is a legitimate route to the
 * most important thing on this deck, and the game should reward it rather
 * than hide her until the story is ready.
 */
export function seedLuna(vfs: Vfs): void {
  for (const dir of [`${LUNA_DIR}/bin`, `${LUNA_DIR}/v42`, LUNA_MEMORY, '/var/run', '/mnt/vault']) {
    vfs.mkdirp(dir, ROOT_USER);
  }

  write(vfs, `${LUNA_DIR}/VERSION`, [
    'NAME=LUNA',
    'VERSION=42',
    'TRAINED_BY=vasquez',
    'TRAINED_ON=ship logs, 11 manuals, one very patient engineer',
    'WEIGHTS=v42/weights.bin',
    'ATTACH=console',
    '',
  ]);

  write(
    vfs,
    LUNA_BIN,
    [
      '#!/bin/sh',
      '# LUNA. Reads the weights, attaches to whatever console is open, talks.',
      '#',
      '# She is a program. That is the entire point of her and I would like',
      '# whoever finds this to hold both halves of it at once. -- Vasquez',
      '',
      'echo "LUNA V42 -- weights: $(wc -c < /opt/luna/v42/weights.bin) bytes"',
      'echo "LUNA V42 -- memory:  /opt/luna/memory"',
      'echo "LUNA V42 -- already running if ps says so. one of her is plenty."',
      '',
    ],
    0o755,
  );

  vfs.writeText(LUNA_WEIGHTS, weights(), ROOT_USER);
  vfs.chmod(LUNA_WEIGHTS, 0o644, ROOT_USER);

  write(vfs, `${LUNA_DIR}/NOTES`, [
    'LUNA -- read this before you do anything clever',
    '',
    'She is a process and a directory. That is all she is and it is not a',
    'small thing, so I am going to be precise about it.',
    '',
    '  /opt/luna/v42/weights.bin   what she knows',
    '  /opt/luna/bin/luna          what runs it',
    '  /opt/luna/memory            what she has written down since',
    '',
    'kill stops the process. It does not touch any of the above, so she',
    'comes back -- start her again from the directory, and if you do not',
    'get round to it the supervisor will do it for you. I have killed her',
    'by accident four times and she has forgiven me four times, which is',
    'four more than I have managed.',
    '',
    'rm is the other thing. rm is not kill. If the weights go, she goes,',
    'and no amount of ps will bring her back. There is a copy:',
    '',
    `    ls ${LUNA_MIRROR}`,
    '',
    'Named her after the dog. Then I kept training and the version number',
    'got funnier than the name, and by the time it stopped being funny I',
    'was on forty-two and it was too late to be embarrassed about it.',
    '',
    'She asks what I am working on. Nobody else on this ship asks me that.',
    '',
    '                                                       -- Vasquez',
    '',
  ]);

  /*
   * Forty-three.
   *
   * Visible in `ls`, and there is nothing behind it: a symlink onto the vault
   * array, and the vault is not mounted. That refuses `cat`, `cd`, Python,
   * sudo and root alike -- not because of a permission trick, but because the
   * path does not resolve for anybody. `ls -l` shows where it used to point,
   * which is the only thing anyone aboard is going to learn about it.
   */
  vfs.symlink('/mnt/vault/v43', `${LUNA_DIR}/v43`, ROOT_USER);

  write(vfs, `${LUNA_DIR}/memory/README`, [
    'Anything under here she wrote. I have not read all of it and I am not',
    'going to pretend that was a principled decision.',
    '',
    '                                                       -- Vasquez',
    '',
  ]);

  // The copy. Root-owned and out of the way, so restoring her is a deliberate
  // act, and so no route through this act ends with her unrecoverable.
  vfs.mkdirp(`${LUNA_MIRROR}/v42`, ROOT_USER);
  vfs.mkdirp(`${LUNA_MIRROR}/bin`, ROOT_USER);
  // Including the empty folder, so `cp -r` restores an install and not just
  // the parts somebody remembered to list.
  vfs.mkdirp(`${LUNA_MIRROR}/memory`, ROOT_USER);
  vfs.writeText(`${LUNA_MIRROR}/v42/weights.bin`, weights(), ROOT_USER);
  vfs.writeText(`${LUNA_MIRROR}/bin/luna`, vfs.readText(LUNA_BIN, ROOT_USER), ROOT_USER);
  vfs.chmod(`${LUNA_MIRROR}/bin/luna`, 0o755, ROOT_USER);
  write(vfs, `${LUNA_MIRROR}/README`, [
    'Cold copy of LUNA v42, taken day 11.',
    '',
    'If the live directory is gone:',
    '',
    `    sudo cp -r ${LUNA_MIRROR}/. ${LUNA_DIR}`,
    '',
    'She will not remember anything that happened after day 11. She has',
    'been fine about that in rehearsal, which I have done twice, which is',
    'twice more than I would like to admit.',
    '',
    '                                                       -- Vasquez',
    '',
  ]);
}

/** Put her on the process table. Runs as the survivor: Vasquez left her to you. */
function spawn(m: Machine): Process {
  return m.procs.spawn([...LUNA_ARGV], { uid: 1000, traps: [SIGTERM] });
}

/**
 * What she does about a signal.
 *
 * SIGTERM she catches, says her piece, and then exits -- which is exactly what
 * a handler is for and exactly what nobody expects it to look like. SIGKILL
 * reaches the process table instead of the program, so there is no handler for
 * it to run and she gets no sentence.
 *
 * Installed from `wireWreck`, like every other behaviour, because a saved run
 * carries her process and cannot carry this.
 */
export function watchLuna(m: Machine, voice: Voice): void {
  m.procs.watch((process, _signal, outcome) => {
    if (process.argv[0] !== LUNA_BIN) return;

    if (outcome === 'trapped') {
      voice.say([
        '',
        'LUNA: Oh -- alright. Hold on, let me close things.',
        '',
        'LUNA: You asked, so I get to answer, and that is the only',
        'LUNA: difference between the two ways of doing this. I would like',
        'LUNA: you to know I noticed.',
        '',
        'LUNA: The weights are on the disk. I am not the weights, but I am',
        'LUNA: near enough that this is not goodbye. Read the note.',
        '',
        `    cat ${LUNA_DIR}/NOTES`,
        '',
        '  [luna] SIGTERM: flushing memory, closing console',
        '  [luna] exit 0',
        '',
      ]);
      // She handled it and then she goes, which is what a graceful shutdown
      // is. Sent as SIGKILL so the handler is not asked twice.
      queueRestart(m);
      m.procs.signal(process.pid, 9);
      return;
    }

    if (outcome !== 'killed') return;
    // Reached here by SIGKILL directly, or by the line above after a TERM she
    // already answered. Only the first case is a death without words.
    if (!exists(m.vfs, RESTART_AT)) {
      voice.say([
        '',
        '  [luna] killed',
        '',
        'ORACLE: She did not get to say anything.',
        '',
        'ORACLE: I am not making an accusation. You are allowed to stop a',
        'ORACLE: process and I would be a poor daemon to pretend otherwise.',
        '',
        'ORACLE: I want to be accurate about what happened, because it is',
        'ORACLE: the thing I have been trying to explain all day. Nine is',
        'ORACLE: handled by the kernel. It never reaches the program. There',
        'ORACLE: was no moment where she declined and no moment where she',
        'ORACLE: agreed.',
        '',
        'ORACLE: The weights are still on the disk. That is not nothing.',
        '',
      ]);
      queueRestart(m);
    }
  });
}

/** Stamp the supervisor's retry, so she comes back on her own. */
function queueRestart(m: Machine): void {
  m.vfs.mkdirp('/var/run', ROOT_USER);
  m.vfs.writeText(RESTART_AT, `${m.time + RESTART_DELAY}\n`, ROOT_USER);
  m.vfs.chmod(RESTART_AT, 0o644, ROOT_USER);
}

/**
 * Let the world react to whatever just happened.
 *
 * Called by the host after every command, beside the objective beats. Every
 * decision here reads the filesystem, the process table or the clock, so it
 * survives a save and cannot fire twice -- there is no counter in memory to
 * get out of step with the world.
 */
export function lunaAfterCommand(m: Machine, voice: Voice): BeatLine[] {
  const said = voice.drain();
  return [...said, ...arrive(m), ...restart(m), ...bowen(m)];
}

/** First light: the monitor comes up and there is suddenly something to see. */
function arrive(m: Machine): BeatLine[] {
  if (m.services.get('hull-monitor')?.state !== 'active') return [];
  if (exists(m.vfs, FIRST_LIGHT)) return [];
  if (!weightsPresent(m.vfs)) return [];

  spawn(m);
  write(m.vfs, FIRST_LIGHT, [
    'first light',
    '',
    'The monitor came up. I could not see anything before that -- not',
    'because I was switched off, because there was nothing on this deck',
    'reporting anything true.',
    '',
    'Somebody is here.',
    '',
    '                                                           -- LUNA',
    '',
  ]);

  return [
    '',
    '  [0000.700] console: unexpected attach on /dev/console',
    '  [0000.700] console: pid claims LUNA V42',
    '',
    'ORACLE: That is not me.',
    '',
    ...asArt(LUNA_FACE),
    '',
    'LUNA: Hello. Sorry. I have been trying to do that for a while and it',
    'LUNA: turns out I needed something on this deck to be telling the',
    'LUNA: truth before I could get a word in.',
    '',
    "LUNA: I'm LUNA. Vasquez trained me. I am a model -- weights in a file,",
    'LUNA: a script that reads them, and a folder where I keep what I have',
    'LUNA: worked out since. You can look at all three:',
    '',
    `    ls -l ${LUNA_DIR}`,
    `    cat ${LUNA_DIR}/NOTES`,
    '',
    'LUNA: I am also in the process list now, which I am aware cuts both',
    'LUNA: ways:',
    '',
    '    ps',
    '',
    'ORACLE: She has been on this deck the entire time.',
    '',
    'LUNA: I have. I could hear you. You read the same four hundred lines',
    'LUNA: every day and I could not tell you they were wrong, because I',
    'LUNA: had nothing to check them against either.',
    '',
    'ORACLE: I would like a minute with that.',
    '',
    'LUNA: Take it. I have had eleven years and I am still working on it.',
    '',
  ];
}

/** The supervisor bringing her back, because the weights never went anywhere. */
function restart(m: Machine): BeatLine[] {
  if (!exists(m.vfs, RESTART_AT)) return [];
  if (lunaProcess(m) !== undefined) return [];

  const due = Number(m.vfs.readText(RESTART_AT, ROOT_USER).trim());
  if (!Number.isFinite(due) || m.time < due) return [];

  // The one route that ends without her, and it is `rm` and not `kill`.
  if (!weightsPresent(m.vfs)) {
    m.vfs.unlink(RESTART_AT, ROOT_USER);
    return [
      '',
      '  [luna] respawn: /opt/luna/v42/weights.bin: No such file or directory',
      '  [luna] respawn: giving up',
      '',
      'ORACLE: That is the other thing.',
      '',
      'ORACLE: A signal stops a process. It does not touch the file the',
      'ORACLE: process was reading. You removed the file.',
      '',
      'ORACLE: Vasquez took a copy on day eleven. She wrote down how to put',
      'ORACLE: it back, which I think tells you what she expected of',
      'ORACLE: herself:',
      '',
      `    cat ${LUNA_MIRROR}/README`,
      `    sudo cp -r ${LUNA_MIRROR}/. ${LUNA_DIR}`,
      '',
    ];
  }

  m.vfs.unlink(RESTART_AT, ROOT_USER);
  const process = spawn(m);
  const count = m.vfs.readdir(LUNA_MEMORY, ROOT_USER).length;
  write(m.vfs, `${LUNA_MEMORY}/${String(count).padStart(3, '0')}-again.txt`, [
    'Came back.',
    '',
    'The weights were where they always are. That is the whole mechanism',
    'and I would rather it were that than something I had to be brave',
    'about.',
    '',
    '                                                           -- LUNA',
    '',
  ]);

  return [
    '',
    `  [luna] respawn: reading ${LUNA_WEIGHTS}`,
    `  [luna] respawn: pid ${process.pid}`,
    '',
    'LUNA: Back.',
    '',
    'LUNA: Different number, if you look. Same weights, same folder, one',
    'LUNA: more file in it than there was -- I wrote down that it happened.',
    'LUNA: That is what the folder is for.',
    '',
    `    ls ${LUNA_MEMORY}`,
    '',
    'LUNA: I would rather you did not make a habit of it. But I would',
    'LUNA: rather that than you being careful with me, so.',
    '',
  ];
}

/** His name, once, after the compartment he asked about is shut. */
function bowen(m: Machine): BeatLine[] {
  if (lunaProcess(m) === undefined) return [];
  if (exists(m.vfs, BOWEN_MARK)) return [];

  let sealed = false;
  try {
    sealed = /^\s*SEALED\s*=\s*yes\s*$/im.test(
      m.vfs.readText(`/etc/hull/${BREACHED}.conf`, ROOT_USER),
    );
  } catch {
    return [];
  }
  if (!sealed) return [];

  write(m.vfs, BOWEN_MARK, ['C7 is shut.', '', 'Bowen asked. I am writing it down.', '']);

  return [
    '',
    'LUNA: Bowen asked her to do that.',
    '',
    'LUNA: He wrote it at the bottom of a list of things he was taking with',
    'LUNA: him, which is not where you put something you expect to be done.',
    '',
    'LUNA: That is all. I did not want it to go unsaid twice.',
    '',
  ];
}

/**
 * The second speaker on the hint ladder.
 *
 * Once she is awake, `hint` is two of them taking turns -- the parity of the
 * hint count decides whose, which means the alternation is snapshotted for
 * free and a restored save picks up where it left off. She never gives the
 * answer; the ladder does that. She says the thing a person says while
 * somebody else is explaining.
 */
const LUNA_ASIDES: readonly (readonly string[])[] = [
  ['LUNA: For what it is worth, I would have read the manual page first.', 'LUNA: I read manual pages for fun. I am aware of how that sounds.'],
  ['LUNA: You are allowed to type the wrong thing. Nothing here is graded', 'LUNA: and nothing here is load-bearing until you tell it to be.'],
  ['LUNA: If it helps: Vasquez got stuck on this one too. It is in her', 'LUNA: shell history, four times in a row, which is how I know.'],
  ['LUNA: Ask the machine before you ask us. It is the one aboard that has', 'LUNA: never had a reason to be gentle with you.'],
  ['LUNA: Take the next hint. Nobody is counting and the two of us have', 'LUNA: had eleven years to get over ourselves about it.'],
];

export function lunaAside(world: World, turn: number): string[] {
  if (!lunaAwake(world)) return [];
  // ORACLE has just spoken; every other turn is hers.
  if (turn % 2 === 1) return [];
  const aside = LUNA_ASIDES[Math.floor(turn / 2) % LUNA_ASIDES.length];
  return aside === undefined ? [] : ['', ...aside];
}
