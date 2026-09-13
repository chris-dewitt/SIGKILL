import { Machine, ROOT_USER, type MachineSnapshot, type Track } from '@sigkill/machine';
import { editorCommands } from '@sigkill/editor';
import { Questbook, questCommands, type BeatLine, type QuestSnapshot } from '@sigkill/quest';
import { artCommands } from './act1/commands.js';
import {
  ORACLE_AWAKE, ORACLE_CANDID, ORACLE_DORMANT, art, shipSchematic, titleCard,
} from './act1/cards.js';
import { HULL_CHECK, seedDeckC } from './act1/deck-c.js';
import { hullCheckRunnable, oxygenTarget, WRECK_OBJECTIVES } from './objectives.js';

/**
 * The moment the survivor wakes up, in the ship's own calendar.
 *
 * `date` reads it, cron schedules against it, and the hull telemetry is
 * stamped backwards from it. Without it the ship believes it is 1970 and the
 * first player to type `date` catches us out.
 *
 * Day one of the incident was 2387-03-01. The console session that wakes the
 * player opens 4,112 days later, which is the number the cold open prints and
 * the number ORACLE has been counting.
 */
export const WAKE_MS = Date.UTC(2398, 5, 8, 4, 12);

export interface WreckOptions {
  /** Which manual voice and hint ladder the player gets. */
  track?: Track;
}

export interface Wreck {
  machine: Machine;
  /** Objectives and hint state, so a save can carry both. */
  questbook: Questbook;
}

/** Adventure commands that must be re-attached after a restore. */
export function wreckCommands(questbook: Questbook) {
  return [
    ...questCommands(questbook, { speaker: 'ORACLE' }),
    ...editorCommands(),
    ...artCommands(),
  ];
}

/**
 * Preconditions live on the Machine as callbacks, not in the snapshot.
 *
 * A save that forgot to put them back would restore a world where the
 * scrubber starts on O2_TARGET=16 — which is the whole of puzzle one,
 * quietly deleted.
 */
export function wireWreck(m: Machine): void {
  m.setPrecondition('scrubber', (vfs) => {
    const target = oxygenTarget({ vfs, services: m.services });
    if (target === null) {
      return { ok: false, reason: 'O2_TARGET missing or unreadable in /etc/life_support.conf' };
    }
    if (target < 19 || target > 23) {
      return { ok: false, reason: `O2_TARGET=${target} outside breathable range 19-23; refusing to run` };
    }
    return { ok: true };
  });

  m.setPrecondition('hull-monitor', (vfs) => {
    const verdict = hullCheckRunnable({ vfs, services: m.services });
    return verdict.ok ? { ok: true } : { ok: false, reason: verdict.reason };
  });
}

/**
 * Bring a saved run back. Same commands, same refusals, same calendar.
 */
export function restoreWreck(
  snap: { machine: MachineSnapshot; quest: QuestSnapshot },
  opts: WreckOptions = {},
): Wreck {
  const track = opts.track ?? 'operator';
  const questbook = new Questbook(WRECK_OBJECTIVES, { track });
  questbook.restore(snap.quest);
  const machine = Machine.restore(snap.machine, {
    hostname: 'nav7',
    track,
    commands: wreckCommands(questbook),
  });
  wireWreck(machine);
  return { machine, questbook };
}

/**
 * The opening state of NAV-7 — Act I, Deck C.
 *
 * Written as code rather than loaded as a snapshot because every line of it
 * is still being tuned. It becomes an authored snapshot when the numbers stop
 * moving, and the objectives in ./objectives.ts do not change either way:
 * they read the world, not this function.
 */
export function bootWreck(opts: WreckOptions = {}): Wreck {
  const track = opts.track ?? 'operator';
  const questbook = new Questbook(WRECK_OBJECTIVES, { track });
  const m = new Machine({
    hostname: 'nav7',
    epoch: WAKE_MS,
    track,
    commands: wreckCommands(questbook),
  });
  const v = m.vfs;

  v.mkdirp('/home/survivor', ROOT_USER);
  v.chown('/home/survivor', 1000, 1000, ROOT_USER);
  v.mkdirp('/etc', ROOT_USER);
  v.mkdirp('/var/log', ROOT_USER);
  v.mkdirp('/tmp', ROOT_USER);
  v.chmod('/tmp', 0o777, ROOT_USER);
  v.mkdirp('/mnt/deck-c', ROOT_USER);
  v.mkdirp('/etc/systemd/system', ROOT_USER);

  v.writeText(
    '/etc/life_support.conf',
    ['# NAV-7 atmosphere controller', 'O2_TARGET=16', 'SCRUBBER_DUTY=0.4', 'N2_BALANCE=auto', ''].join('\n'),
    ROOT_USER,
  );
  v.chmod('/etc/life_support.conf', 0o666, ROOT_USER);

  v.writeText(
    '/var/log/boot.log',
    [
      '[0000.00] NAV-7 cold start',
      '[0000.412] reactor: output nominal',
      // The number, in the log, at boot. The README tells the player this
      // machine writes everything down; it has to be true before they look.
      '[0000.881] scrubber: reading /etc/life_support.conf',
      '[0000.884] scrubber: FAIL - O2_TARGET=16 outside breathable range 19-23',
      '[0000.884] scrubber: refusing to run; entering failed state',
      '[0001.002] atmosphere: O2 below crew minimum',
      '[0001.180] hull-monitor: exec ' + HULL_CHECK + ': Permission denied',
      '[0001.181] hull-monitor: refusing to run; entering failed state',
      '[0001.310] comms: no carrier',
      '[0001.900] init: 2 units failed. See: systemctl --failed',
      '[4112.000] console: session opened',
      '',
    ].join('\n'),
    ROOT_USER,
  );

  v.writeText(
    '/home/survivor/README',
    [
      'If you are reading this, the ship woke you and not me.',
      '',
      'The scrubber will not start. It has not started in a very long time.',
      'Ask it why -- it has been saying the same thing the whole time:',
      '',
      '    systemctl status scrubber',
      '',
      'It objects to a number. That number is in a config file over in /etc,',
      'which is where this ship keeps every setting it has:',
      '',
      '    ls /etc',
      '',
      'Open the life support one and put the number back inside the range it',
      'asks for. Any editor aboard will do:',
      '',
      '    vi /etc/life_support.conf      (press i to type, :wq to save)',
      '    nano /etc/life_support.conf    (^O saves, ^X leaves)',
      '',
      'Then start the service. That part needs sudo.',
      '',
      'If you do not know a command, do not guess and do not ask the',
      'daemon -- ask the ship. It carries its own manuals:',
      '',
      '    man systemctl',
      '    man sudo',
      '',
      'That is the whole trick, honestly. I have been doing this twenty',
      'years and I still read the manual first. Anyone who tells you',
      'different is remembering their job better than they did it.',
      '',
      'I set the target low to stretch the reserve. I thought I was buying',
      'us weeks. The controller refused it inside of a second and I spent',
      'eleven years deciding whether to be grateful.',
      '',
      'After that: the air is not the only thing wrong with this deck, and',
      'the rest of it is not in my handwriting, it is in the logs. My notes',
      'are in my quarters. The whole crew is still on this machine --',
      '',
      '    ls /home',
      '    cat /etc/passwd',
      '',
      'Read my shell history if you get stuck. Everything I ever typed on',
      'this ship is in it and most of it worked:',
      '',
      '    cat /home/vasquez/.bash_history',
      '',
      '  - Vasquez, engineering',
      '',
    ].join('\n'),
    ROOT_USER,
  );
  v.chown('/home/survivor/README', 1000, 1000, ROOT_USER);

  // `ls` in an empty home directory is a dead end, and a dead end on the very
  // first command reads as a broken game rather than an empty room. Everything
  // here is either a trail to the next thing or a reason to care about it.
  v.mkdirp('/home/survivor/logs', ROOT_USER);
  v.chown('/home/survivor/logs', 1000, 1000, ROOT_USER);

  v.writeText(
    '/home/survivor/logs/vasquez.log',
    [
      'day 1    Reactor holding. Scrubber holding. Everyone accounted for.',
      'day 6    Chen says the O2 reserve maths does not work. Chen is right.',
      'day 9    Dropped O2_TARGET to 16 to stretch it. Controller threw it out',
      '         and shut the scrubber down. Argued with it for six hours.',
      'day 9    It is not wrong. 16 is not breathable. I knew that.',
      'day 11   Put the survivor account on the sudoers list. If anyone wakes',
      '         up after me they will need to start services themselves.',
      'day 12   Chen is gone. Bowen took a pod and did not say where.',
      'day 14   Writing a README. Whoever you are: the fix is one number.',
      '',
    ].join('\n'),
    ROOT_USER,
  );
  v.chown('/home/survivor/logs/vasquez.log', 1000, 1000, ROOT_USER);

  v.writeText(
    '/home/survivor/logs/atmosphere.log',
    [
      '[day 9  03:14] scrubber: config rejected, O2_TARGET=16',
      '[day 9  03:14] scrubber: entering failed state',
      '[day 9  03:15] atmosphere: reserve draw switched to passive',
      '[day 12 00:00] atmosphere: reserve 61%',
      '[day 400 00:00] atmosphere: reserve 12%',
      '[day 4112 00:00] atmosphere: reserve 4%, console session opened',
      '',
    ].join('\n'),
    ROOT_USER,
  );

  v.writeText(
    '/etc/crew.csv',
    [
      'name,department,status',
      'vasquez,engineering,deceased',
      'chen,medical,deceased',
      'okonkwo,cargo,deceased',
      'bowen,navigation,unknown',
      'survivor,-,awake',
      '',
    ].join('\n'),
    ROOT_USER,
  );

  /*
   * The rest of the deck: quarters, accounts, the nine hull compartments and
   * ten days of pressure telemetry.
   *
   * Seeded before any service starts, because the hull monitor's precondition
   * reads a file this writes and the boot sequence below genuinely attempts
   * the start.
   */
  seedDeckC(v, WAKE_MS);

  v.writeText('/etc/shadow', 'root:!locked:19000:0:99999:7:::\n', ROOT_USER);
  v.chmod('/etc/shadow', 0o600, ROOT_USER);

  v.writeText(
    '/etc/sudoers',
    [
      '# NAV-7 privilege policy',
      '# Vasquez added the survivor account before the last shift. Lucky you.',
      'root      ALL=(ALL) ALL',
      'survivor  ALL=(ALL) ALL',
      '',
    ].join('\n'),
    ROOT_USER,
  );
  v.chmod('/etc/sudoers', 0o644, ROOT_USER);

  v.writeText(
    '/etc/systemd/system/scrubber.service',
    [
      '[Unit]',
      'Description=Atmosphere scrubber',
      'After=reactor.service',
      '',
      '[Service]',
      'ExecStart=/usr/sbin/scrubber --config /etc/life_support.conf',
      'Restart=on-failure',
      '',
      '[Install]',
      'WantedBy=multi-user.target',
      '',
    ].join('\n'),
    ROOT_USER,
  );

  v.writeText(
    '/etc/systemd/system/reactor.service',
    [
      '[Unit]',
      'Description=Reactor containment monitor',
      '',
      '[Service]',
      'ExecStart=/usr/sbin/reactord',
      'Restart=always',
      '',
      '[Install]',
      'WantedBy=multi-user.target',
      '',
    ].join('\n'),
    ROOT_USER,
  );

  // The reactor survived the incident; the scrubber did not. Enabling it here
  // means `systemctl list-units` opens on one healthy unit and one casualty,
  // which is a more legible starting picture than everything being dead.
  m.services.enable('reactor');

  wireWreck(m);

  m.services.startEnabled();

  /*
   * The ship has been failing to start this thing for eleven years, so it is
   * already in a failed state before the player arrives -- and that state is
   * produced by genuinely attempting the start, not by hand-writing a fake
   * error onto the unit.
   *
   * This is the fix for the bug that made Act I unfinishable. The README and
   * the first hint both tell the player that `systemctl status scrubber` will
   * name the number it objects to. Before this, status said only "inactive"
   * until the player had already guessed the step they were trying to find,
   * and the hint's "I have been reading that same line for eleven years"
   * pointed at a line that did not exist.
   */
  m.services.start('scrubber');

  // Same reasoning for the hull monitor: it has failed every boot for eleven
  // years, and `systemctl status hull-monitor` has to be able to say so before
  // the player has worked out that it is the thing to ask.
  m.services.start('hull-monitor');

  m.shell.cwd = '/home/survivor';
  m.shell.env['PWD'] = '/home/survivor';
  return { machine: m, questbook };
}

/**
 * The opening, with the act's one title card and ORACLE's first two faces.
 *
 * A function rather than a constant because the schematic counts sealed
 * compartments out of `/etc/hull` -- so it and `deck` can never disagree about
 * how many are holding. The hull percentage is the exception and stays a
 * literal: it is the number Vasquez wrote on a clipboard on day nine, and the
 * whole epilogue turns on ORACLE having recited it ever since.
 */
export function coldOpen(m: Machine): BeatLine[] {
  return [
    ...art(titleCard()),
    '',
    'NAV-7 MAINTENANCE SHELL v2.3.1 (degraded)',
    'last login: 4,112 days ago from console',
    '',
    ...art(shipSchematic(m.vfs, { hullClaim: '61%', reserve: '9h 14m', aboard: 1 })),
    '',
    ...art(ORACLE_DORMANT),
    '',
    "ORACLE: You're awake.",
    'ORACLE: I did not expect that. I want to be careful about how much',
    'ORACLE: I expect, now.',
    '',
    ...art(ORACLE_AWAKE),
    '',
    "ORACLE: I am what is left of the maintenance daemon. I can't move.",
    "ORACLE: I can't see. I have read the same four hundred lines of log",
    'ORACLE: every day for eleven years and not one of them has ever',
    'ORACLE: changed.',
    '',
    'ORACLE: You can change them.',
    '',
    'ORACLE: Start with: ls',
    'ORACLE: Vasquez left you a note. Read it: cat README',
    '',
    'ORACLE: When you meet a command you do not know, the ship will',
    'ORACLE: explain it:  man <command>.  Try  man ls  now, so that you',
    'ORACLE: know it works before you need it.',
    '',
    'ORACLE: Once the hull monitor is running I can draw this deck for',
    'ORACLE: you. Two commands: deck    and: pressure',
    '',
    'ORACLE: And if you are properly stuck, type: hint. It costs nothing.',
    'ORACLE: I am not keeping score. I stopped keeping score a long time',
    'ORACLE: ago.',
    '',
  ];
}

/**
 * What ORACLE says when the act is finished.
 *
 * Act I ended in silence before this: both objectives would go green and
 * nothing would happen, which is why a playthrough felt like it stopped
 * rather than ended.
 *
 * A function, like the cold open, so the closing schematic is drawn from the
 * finished ship. The player sees the same widget twice with the sealed count
 * changed by their own hand -- and the hull percentage still reading 61%,
 * which is what ORACLE is about to admit it never had any business saying.
 */
export function epilogue(m: Machine): BeatLine[] {
  return [
    '',
    ...art(ORACLE_CANDID),
    '',
    'ORACLE: Before you go any further I have to correct something, and I',
    'ORACLE: would rather do it now than have you find it.',
    '',
    ...art(shipSchematic(m.vfs, { hullClaim: '61%?', reserve: '9h 14m', aboard: 1 })),
    '',
    'ORACLE: That number. Sixty-one percent. I have told it to an empty',
    'ORACLE: room every day for eleven years.',
    '',
    'ORACLE: It came off a clipboard. Vasquez wrote it down by hand on day',
    'ORACLE: nine and I have been reciting it ever since, because the thing',
    'ORACLE: that would have corrected me was a file with the wrong',
    'ORACLE: permissions on it.',
    '',
    'ORACLE: I was not lying. I want to be precise about that, and I also',
    'ORACLE: want to be honest that the distinction did not help anybody.',
    '',
    'ORACLE: The count beside it is real. You can check it yourself --',
    'ORACLE: that is the difference, and you made it:  deck',
    '',
    'ORACLE: Everything else I have told you came from a log. You have now',
    'ORACLE: fixed two of the things that write those logs. Do not take my',
    'ORACLE: numbers on faith again. Ask the ship. It is the one aboard',
    'ORACLE: that has never once been wrong.',
    '',
    'ORACLE: There are three more decks and I cannot see any of them.',
    '',
    ...art([
      '  ── ACT I COMPLETE ──────────────',
      '',
      '  The ship is breathing and the',
      '  hull is closed.',
      '',
      '  Four puzzles, one skill wearing',
      '  four hats: ask the machine what',
      '  is wrong, read the answer, change',
      '  the one thing it named.',
      '',
      '    systemctl status   it will tell you',
      '    vi / sed           change one thing',
      '    chmod +x           a file becomes',
      '                       a program',
      '    grep               it is in the log',
      '',
      '  Bowen took a pod on day twelve,',
      '  wrote down a heading, and did not',
      '  come back. Deck B is open to space.',
      '  Chen kept records nobody has read',
      '  in eleven years.',
      '',
      '  Act II is not written yet. Type',
      '  `objectives` to see what you did --',
      '  or keep looking. There is more on',
      '  this deck than the four things I',
      '  asked you for.',
      '',
    ]),
  ];
}
