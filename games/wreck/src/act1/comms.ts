import { ROOT_USER, type Machine, type Vfs } from '@sigkill/machine';
import type { BeatLine, World } from '@sigkill/quest';
import type { Voice } from './luna.js';

/**
 * The way off this ship, and the act's capstone.
 *
 * Two lessons, neither of them a repeat of puzzles one to five.
 *
 * **A lock is a claim, not a fact.** The transmitter is held by a lock file
 * naming a pid that is not on the process table any more -- whatever took the
 * array during the event never released it, because it was not there to. The
 * hardware is fine. Nothing is broken. The player reads the lock, looks for
 * its owner, does not find one, and clears it. That is a real thing that
 * happens to real people on real machines, roughly weekly.
 *
 * **Assembling a document from evidence.** The daemon transmits whatever is
 * in the outbound spool, and a valid packet needs three facts that live in
 * three different files. There is no intended route: `cat` with redirects, a
 * heredoc, a script, command substitution, Python, or typing it into vi all
 * work, because the goal reads the finished file and never the transcript.
 *
 * The reply is local too. Nothing here touches `packages/machine`'s network:
 * NAV-7 is alone in a remote stretch and the only thing that changes is that
 * somebody, somewhere, eventually answers.
 */

export const COMMS_LOCK = '/var/lock/comms.lock';
export const SPOOL = '/var/spool/comms';
export const SPOOL_OUT = `${SPOOL}/out`;
export const SPOOL_IN = `${SPOOL}/in`;
export const PACKET = `${SPOOL_OUT}/distress.txt`;
export const REPLY = `${SPOOL_IN}/reply.txt`;
/** When the packet first became valid, in virtual-clock milliseconds. */
const SENT_AT = '/var/run/comms.sent';
/** The ship's own identity, and the position the last fix put it at. */
export const SHIP_ID = '/etc/ship-id';
export const LAST_FIX = '/etc/nav/last-fix.txt';

/**
 * How long the answer takes, in virtual-clock milliseconds.
 *
 * The host ticks a second per command, so this is a handful of commands: long
 * enough that sending and being answered are two separate moments, short
 * enough that nobody is made to wait for a tow in a game about competence.
 */
const REPLY_DELAY = 4000;

/** The pid in the lock. Nothing is holding it; that is the entire puzzle. */
const GHOST_PID = 204;

function read(vfs: Vfs, path: string): string | undefined {
  try {
    return vfs.readText(path, ROOT_USER);
  } catch {
    return undefined;
  }
}

function write(vfs: Vfs, path: string, lines: string[], mode = 0o644): void {
  vfs.mkdirp(path.slice(0, path.lastIndexOf('/')), ROOT_USER);
  vfs.writeText(path, lines.join('\n'), ROOT_USER);
  vfs.chmod(path, mode, ROOT_USER);
}

/** The pid the lock claims, if the lock is there and says so. */
function lockedBy(vfs: Vfs): number | undefined {
  const lock = read(vfs, COMMS_LOCK);
  if (lock === undefined) return undefined;
  const pid = /^\s*PID\s*=\s*(\d+)\s*$/m.exec(lock)?.[1];
  return pid === undefined ? undefined : Number(pid);
}

/**
 * Why `systemctl start comms` refuses, in the unit's own words.
 *
 * Deliberately a full sentence with the pid in it. The refusal is the first
 * half of the puzzle -- it has to hand over something to go and check, the
 * same way the scrubber hands over the number it objected to.
 */
export function commsBlocked(world: World): { ok: true } | { ok: false; reason: string } {
  const pid = lockedBy(world.vfs);
  if (pid === undefined) return { ok: true };

  const holder = world.procs.list().find((p) => p.pid === pid);
  if (holder) {
    return {
      ok: false,
      reason: `transmit device held by pid ${pid} (${holder.argv[0] ?? 'unknown'}); refusing to run`,
    };
  }
  return {
    ok: false,
    reason:
      `transmit device locked by pid ${pid}, which is not running; ` +
      `stale lock at ${COMMS_LOCK}; refusing to run`,
  };
}

/** Has the transmitter been freed and started? */
export function commsUp(world: World): boolean {
  return world.services.get('comms')?.state === 'active';
}

/**
 * What a valid distress packet has to contain.
 *
 * Three facts from three files, matched tolerantly. Case does not matter,
 * order does not matter, and anything else in the file is welcome -- a player
 * who pipes in the whole of `deck` alongside the required fields has written
 * a better packet, not a failing one.
 */
const REQUIRED: ReadonlyArray<{ id: string; label: string; test: RegExp; source: string }> = [
  {
    id: 'ship',
    label: 'which ship is calling',
    test: /\bNAV-?7\b/i,
    source: SHIP_ID,
  },
  {
    id: 'position',
    label: 'where it is',
    test: /\bKV-OUTER-9\b/i,
    source: LAST_FIX,
  },
  {
    id: 'souls',
    label: 'how many people are aboard',
    test: /souls[_\s-]*aboard\s*[:=]?\s*1\b/i,
    source: '/etc/crew.csv',
  },
];

/** Required fields the packet is still missing. Empty means it is sendable. */
export function packetGaps(world: World): typeof REQUIRED {
  const packet = read(world.vfs, PACKET);
  if (packet === undefined) return REQUIRED;
  return REQUIRED.filter((field) => !field.test.test(packet));
}

export function packetReady(world: World): boolean {
  return packetGaps(world).length === 0;
}

/** Did the player put Bowen's heading in? Optional, and the tug notices. */
export function packetNamesBowen(world: World): boolean {
  return /114\s*mark\s*9/i.test(read(world.vfs, PACKET) ?? '');
}

/** The answer, once it has arrived. */
export function replyArrived(world: World): boolean {
  return world.vfs.exists(REPLY, ROOT_USER);
}

/**
 * Everything comms has on the disk before the player touches anything.
 *
 * The lock is here from the first command, like LUNA's directory is: a player
 * who reads `/var/lock` on turn one finds the whole answer to a puzzle the
 * story has not opened yet, and that is the correct reward for looking.
 */
export function seedComms(vfs: Vfs): void {
  write(vfs, '/etc/systemd/system/comms.service', [
    '[Unit]',
    'Description=Long-range communications',
    'After=reactor.service',
    '',
    '[Service]',
    `ExecStart=/usr/sbin/commsd --spool ${SPOOL}`,
    'Restart=on-failure',
    '',
    '[Install]',
    'WantedBy=multi-user.target',
    '',
  ]);

  write(vfs, COMMS_LOCK, [
    '# NAV-7 transmit device lock',
    '#',
    '# Written by whatever holds the array. Removed by the same thing when it',
    '# is finished. If it is still here and nothing holds it, it is rubbish.',
    '',
    `PID=${GHOST_PID}`,
    'HOLDER=transit-control',
    'DEVICE=/dev/array0',
    'SINCE=T+0000',
    '',
  ]);

  write(vfs, SHIP_ID, [
    'CALLSIGN=NAV-7',
    'REGISTRY=Kepler-Vance Salvage & Recovery',
    'HULL=KV-1140',
    'BERTHS=40',
    '',
  ]);

  write(vfs, LAST_FIX, [
    'NAVIGATION -- LAST GOOD FIX',
    '',
    'The slate went with pod 2. This is the last fix the ship took by itself.',
    '',
    'POSITION=KV-OUTER-9',
    'DRIFT=0.004 per hour, unpowered',
    'NEAREST_LANE=KV-OUTER-7, 2 days at tow speed',
    '',
    'Anybody calling for help wants the POSITION line. It is the only part of',
    'this file that means anything to somebody who is not already here.',
    '',
  ]);

  write(vfs, `${SPOOL}/README`, [
    'OUTBOUND SPOOL',
    '',
    `commsd transmits every file in ${SPOOL_OUT} once the carrier is up, then`,
    `leaves it there. Replies land in ${SPOOL_IN}.`,
    '',
    'A distress packet needs three things, and a receiver that cannot find all',
    'three will not route it:',
    '',
    '  CALLSIGN       who is calling        see /etc/ship-id',
    '  POSITION       where they are        see /etc/nav/last-fix.txt',
    '  SOULS_ABOARD   how many people       see /etc/crew.csv',
    '',
    `Write the file yourself. There is a form in ${SPOOL_OUT}/distress.template`,
    'if you would rather start from one. How you fill it in is your business --',
    'an editor, a redirect, a script, whatever you like.',
    '',
    'Anything else you add rides along. Condition, casualties, a heading you',
    'want somebody to look at. Put in what you would want to know.',
    '',
  ]);

  write(vfs, `${SPOOL_OUT}/distress.template`, [
    'DISTRESS',
    '',
    'CALLSIGN=',
    'POSITION=',
    'SOULS_ABOARD=',
    '',
    '# Anything below here is free text and goes out with it.',
    '',
  ]);

  vfs.mkdirp(SPOOL_IN, ROOT_USER);

  // The spool is the player's to write in. Everything else here is root's.
  for (const dir of [SPOOL_OUT, SPOOL_IN]) {
    vfs.chown(dir, 1000, 1000, ROOT_USER);
  }
  vfs.chown(`${SPOOL_OUT}/distress.template`, 1000, 1000, ROOT_USER);
}

/**
 * The answer, and the only thing in Act I that happens because time passed.
 *
 * Driven from the after-command hook rather than a service, for the same
 * reason LUNA's respawn is: every decision reads the filesystem and the
 * virtual clock, so it cannot fire twice, it survives a save, and it replays
 * identically. The stamp file is the state; there is no timer object
 * anywhere.
 */
export function commsAfterCommand(m: Machine, voice: Voice): void {
  const world = m as unknown as World;
  if (replyArrived(world)) return;
  if (!commsUp(world) || !packetReady(world)) return;

  const stamped = read(m.vfs, SENT_AT);
  if (stamped === undefined) {
    write(m.vfs, SENT_AT, [String(m.time), '']);
    voice.say(sending());
    return;
  }

  const due = Number(stamped.trim()) + REPLY_DELAY;
  if (!Number.isFinite(due) || m.time < due) return;

  write(m.vfs, REPLY, replyText(packetNamesBowen(world)));
  m.vfs.chown(REPLY, 1000, 1000, ROOT_USER);
  voice.say(answered(packetNamesBowen(world)));
}

/** The moment it goes out. Quiet, because nothing has answered yet. */
function sending(): BeatLine[] {
  return [
    '',
    '  [commsd] carrier acquired',
    `  [commsd] transmitting ${PACKET}`,
    '  [commsd] sent. no acknowledgement yet',
    '',
    'ORACLE: That is away.',
    '',
    'ORACLE: I would like to be careful about what I promise here. A packet',
    'ORACLE: leaving is not a packet arriving, and I have no way to tell you',
    'ORACLE: which one just happened.',
    '',
    'LUNA: He knows, ORACLE.',
    '',
    'LUNA: Doc. Sit down. There is nothing else to do until somebody says',
    'LUNA: something back, and you have been standing up for two days.',
    '',
  ];
}

/** ELLEN MAY. */
function replyText(withHeading: boolean): string[] {
  return [
    'INBOUND -- carrier KV-OUTER, relayed',
    '',
    'NAV-7, NAV-7, this is tug ELLEN MAY, forty hours out and closing.',
    '',
    'Received your packet. Good packet, by the way. You would not believe',
    'what people send me. Last month I got a photograph.',
    '',
    'Sitting here telling me you have air, you have a hull, and you have one',
    'soul aboard. I am going to take all three of those personally until I',
    'can see them myself.',
    '',
    'Do not fix anything else. I mean that kindly. Whatever is still broken',
    'over there has waited two days and it can wait forty hours, and I would',
    'rather tow a ship with one tired engineer on it than one with one tired',
    'engineer somewhere inside it.',
    '',
    ...(withHeading
      ? [
          'You logged a pod on one-fourteen mark nine. I have flagged it. That is',
          'empty sky on my charts, but my charts are not the good ones, and',
          'somebody aiming at nothing usually thinks they are aiming at',
          'something.',
          '',
        ]
      : []),
    'Put the kettle on. I will do the rest.',
    '',
    '                                      -- ELLEN MAY, salvage tug',
    '',
  ];
}

/** What the ship says when the answer lands. */
function answered(withHeading: boolean): BeatLine[] {
  return [
    '',
    '  [commsd] inbound carrier',
    `  [commsd] message written to ${REPLY}`,
    '',
    'ORACLE: Somebody answered.',
    '',
    'ORACLE: I want to be accurate. I did not expect this. I had assigned it',
    'ORACLE: a low likelihood and I was going to tell you afterwards.',
    '',
    `    cat ${REPLY}`,
    '',
    'LUNA: Read it out loud. I can read it myself. Read it out loud anyway.',
    '',
    ...(withHeading
      ? [
          'LUNA: You put his heading in. I noticed that and I did not say',
          'LUNA: anything at the time.',
          '',
          'LUNA: He left us, Doc, and you gave a stranger his coordinates so',
          'LUNA: somebody would go and look. I am going to think about that',
          'LUNA: for a while.',
          '',
        ]
      : []),
  ];
}
