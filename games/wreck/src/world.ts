import { Machine, ROOT_USER, type MachineSnapshot, type Track } from '@sigkill/machine';
import { editorCommands } from '@sigkill/editor';
import { Questbook, questCommands, type BeatLine, type QuestSnapshot } from '@sigkill/quest';
import { artCommands } from './act1/commands.js';
import { commsAfterCommand, commsBlocked, seedComms } from './act1/comms.js';
import { conversationCommands } from './act1/conversation.js';
import { seedProjects } from './act1/projects.js';
import {
  ORACLE_AWAKE, ORACLE_CANDID, ORACLE_DORMANT, art, shipSchematic, titleCard,
} from './act1/cards.js';
import { HULL_CHECK, seedDeckC } from './act1/deck-c.js';
import { startPurge, watchPurge } from './act1/purge.js';
import {
  lunaAfterCommand, lunaAside, lunaAwake, seedLuna, watchLuna, LUNA_DIR, Voice,
} from './act1/luna.js';
import { hullCheckRunnable, oxygenTarget, WRECK_OBJECTIVES } from './objectives.js';

/**
 * The moment DeWitt wakes up, in the ship's own calendar.
 *
 * `date` reads it, cron schedules against it, and the hull telemetry is
 * stamped backwards from it. Without it the ship believes it is 1970 and the
 * first player to type `date` catches us out.
 *
 * The event was two days earlier, at 04:12 on 2398-06-06. Everything the crew
 * wrote counts in hours from it -- `T+09:40` and so on -- and everything an
 * instrument wrote carries a real stamp, so a player can always tell a diary
 * from a sensor. Forty-eight hours is the only number the fiction commits to;
 * the calendar date is here because `date` has to say something.
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
  /**
   * Let the world react to the command that just ran, and return anything it
   * wants said.
   *
   * The seam a companion needs. An objective beat fires when a goal closes;
   * this fires every turn, so something that arrives when a service comes up,
   * or answers a signal it was sent in the middle of a command, has somewhere
   * to speak from. Every decision behind it reads the filesystem, the process
   * table or the clock, so it survives a save and cannot fire twice.
   */
  afterCommand: () => BeatLine[];
}

/** Adventure commands that must be re-attached after a restore. */
export function wreckCommands(questbook: Questbook) {
  return [
    // Two speakers once she is awake. The aside reads the world, so a hint
    // before first light is ORACLE alone without anything having to remember
    // that it is.
    ...questCommands(questbook, { speaker: 'ORACLE', aside: lunaAside }),
    ...editorCommands(),
    ...artCommands(),
    ...conversationCommands(),
  ];
}

/**
 * Preconditions live on the Machine as callbacks, not in the snapshot.
 *
 * A save that forgot to put them back would restore a world where the
 * scrubber starts on O2_TARGET=16 — which is the whole of puzzle one,
 * quietly deleted.
 */
export function wireWreck(m: Machine): Voice {
  // What the purge does when somebody asks it to stop, and what she does.
  // Behaviour, not state, so both are re-attached on every boot including a
  // restored one -- a save carries her process and cannot carry her handler.
  const voice = new Voice();
  watchPurge(m);
  watchLuna(m, voice);

  m.setPrecondition('scrubber', (vfs) => {
    const target = oxygenTarget({ vfs, services: m.services, procs: m.procs });
    if (target === null) {
      return { ok: false, reason: 'O2_TARGET missing or unreadable in /etc/life_support.conf' };
    }
    if (target < 19 || target > 23) {
      return { ok: false, reason: `O2_TARGET=${target} outside breathable range 19-23; refusing to run` };
    }
    return { ok: true };
  });

  m.setPrecondition('hull-monitor', (vfs) => {
    const verdict = hullCheckRunnable({ vfs, services: m.services, procs: m.procs });
    return verdict.ok ? { ok: true } : { ok: false, reason: verdict.reason };
  });

  // The stale lock. Re-attached like the others, and for the same reason: a
  // restored save carries the lock file but cannot carry the rule that makes
  // it mean something.
  m.setPrecondition('comms', (vfs) =>
    commsBlocked({ vfs, services: m.services, procs: m.procs }),
  );

  return voice;
}

/**
 * Everything the world wants to say after a command, in one place.
 *
 * Both boot paths go through this, so a restored save reacts exactly like a
 * fresh one. Order matters a little: LUNA speaks first because she is the one
 * who notices things, and comms speaks second because what it has to say is
 * usually the bigger event and should land last.
 */
function afterCommand(m: Machine, voice: Voice): BeatLine[] {
  const said = lunaAfterCommand(m, voice);
  commsAfterCommand(m, voice);
  return [...said, ...voice.drain()];
}

/**
 * Legacy save migration: survivor -> dewitt account rename.
 *
 * Early saves can carry /etc/sudoers that still grants survivor. If that save
 * is restored after the account rename, the prompt shows dewitt but sudo is
 * denied, which blocks Act I. Bring the sudoers file forward in place.
 */
function migrateIdentity(m: Machine): void {
  let sudoers: string;
  try {
    sudoers = m.vfs.readText('/etc/sudoers', ROOT_USER);
  } catch {
    return;
  }

  const hasDewitt = /^\s*dewitt\s+ALL=\(ALL\)\s+ALL\s*$/m.test(sudoers);
  if (hasDewitt) return;

  const hasSurvivor = /^\s*survivor\s+ALL=\(ALL\)\s+ALL\s*$/m.test(sudoers);
  if (!hasSurvivor) return;

  m.vfs.writeText(
    '/etc/sudoers',
    sudoers.replace(
      /^\s*survivor\s+ALL=\(ALL\)\s+ALL\s*$/m,
      // Spaced to match the seeded file, so a migrated save and a fresh one
      // read identically when the player cats it.
      'dewitt    ALL=(ALL) ALL',
    ),
    ROOT_USER,
  );
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
  migrateIdentity(machine);
  const voice = wireWreck(machine);
  return { machine, questbook, afterCommand: () => afterCommand(machine, voice) };
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

  v.mkdirp('/home/dewitt', ROOT_USER);
  v.chown('/home/dewitt', 1000, 1000, ROOT_USER);
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
      '[0001.310] comms: transmit device held, no carrier',
      '[0001.311] comms: refusing to run; entering failed state',
      '[0001.900] init: 3 units failed. See: systemctl --failed',
      '[0002.000] profile: ferry (declared T+0000, authority AUTOMATED)',
      '[0048.000] console: session opened',
      '',
    ].join('\n'),
    ROOT_USER,
  );

  v.writeText(
    '/home/dewitt/README',
    [
      'Doc --',
      '',
      'If you are reading this, the ship woke you and not me, and I am going',
      'to write fast and badly rather than carefully and not at all.',
      '',
      'The scrubber will not start. Ask it why. It has been saying the same',
      'thing since this morning and it is the only thing aboard that is:',
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
      'I did not set that number. Nobody did. The ship rolled itself onto',
      'the ferry profile this morning -- the configuration for a hull with',
      'no one inside it -- and every single thing that is wrong down here',
      'is that one decision being carried out properly.',
      '',
      '    cat /etc/ferry.profile',
      '',
      'It is not broken, Doc. That is the part I need you to hold on to,',
      'because it is going to look broken and you are going to start',
      'replacing things. It is obedient. Somebody told it a lie at 0600 and',
      'it has been believing them ever since, and it will believe you too.',
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
      'You are going to be fine at this. I have watched you be fine at this',
      'for a year while you apologised for it. Read the error. Change the',
      'one thing it named. Look again.',
      '',
      '  - Vasquez, engineering',
      '',
    ].join('\n'),
    ROOT_USER,
  );
  v.chown('/home/dewitt/README', 1000, 1000, ROOT_USER);

  // `ls` in an empty home directory is a dead end, and a dead end on the very
  // first command reads as a broken game rather than an empty room. Everything
  // here is either a trail to the next thing or a reason to care about it.
  v.mkdirp('/home/dewitt/logs', ROOT_USER);
  v.chown('/home/dewitt/logs', 1000, 1000, ROOT_USER);

  v.writeText(
    '/home/dewitt/logs/vasquez.log',
    [
      'T+00:06  Alarm. Every board on the deck went red in the same second,',
      '         which is not how things break. Profile says ferry. Crew zero.',
      'T+00:31  Cannot rewrite the profile from this console. It is not a',
      '         permissions problem. There is no command. Nobody built one,',
      '         because who would ever need to argue with it.',
      'T+01:10  Scrubber refuses O2_TARGET=16 and shuts down rather than run',
      '         it. Sixteen is the ferry number. Sixteen is not breathable.',
      'T+01:12  It is the only system aboard that said no this morning.',
      'T+04:20  Put your account on the sudoers list. Doc, if the ship wakes',
      '         you, you will need to start things yourself.',
      'T+09:40  Okonkwo went aft. Chen is not answering. I am not going to',
      '         write down what I think that means.',
      'T+26:00  Writing a README. Whoever you are: it is one number, then one',
      '         letter, then one signal. In that order. It is not hard.',
      '',
    ].join('\n'),
    ROOT_USER,
  );
  v.chown('/home/dewitt/logs/vasquez.log', 1000, 1000, ROOT_USER);

  v.writeText(
    '/home/dewitt/logs/atmosphere.log',
    [
      '[T+00:02] profile: ferry selected, crew aboard 0',
      '[T+00:02] atmosphere: derating to preservation minimum',
      '[T+00:02] life_support.conf: O2_TARGET 21 -> 16 (profile)',
      '[T+00:03] scrubber: config rejected, O2_TARGET=16 outside 19-23',
      '[T+00:03] scrubber: entering failed state',
      '[T+00:04] atmosphere: reserve draw switched to passive',
      '[T+00:04] atmosphere: C4 medical held at crewed pressure (autodoc)',
      '[T+47:58] atmosphere: reserve 81%, console session opened',
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
      'dewitt,-,awake',
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

  /*
   * Her weights, her script and her folder, on the disk from the first
   * command -- long before she is running.
   *
   * A player who types `ls /opt` on turn one should find the most important
   * thing on this deck, not a hole where the story has not opened it yet.
   * She wakes when the hull monitor does; she has been here all along.
   */
  seedLuna(v);
  seedProjects(v);
  seedComms(v);

  v.writeText('/etc/shadow', 'root:!locked:19000:0:99999:7:::\n', ROOT_USER);
  v.chmod('/etc/shadow', 0o600, ROOT_USER);

  v.writeText(
    '/etc/sudoers',
    [
      '# NAV-7 privilege policy',
      '# Vasquez added DeWitt before the last shift. Lucky you.',
      'root      ALL=(ALL) ALL',
      'dewitt    ALL=(ALL) ALL',
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

  const voice = wireWreck(m);

  m.services.startEnabled();

  /*
   * The ship has been failing to start this thing since the profile changed,
   * so it is already in a failed state before the player arrives -- and that
   * state is produced by genuinely attempting the start, not by hand-writing
   * a fake error onto the unit.
   *
   * This is the fix for the bug that made Act I unfinishable. The README and
   * the first hint both tell the player that `systemctl status scrubber` will
   * name the number it objects to. Before this, status said only "inactive"
   * until the player had already guessed the step they were trying to find,
   * and the hint pointed at a line that did not exist.
   */
  m.services.start('scrubber');

  // Same reasoning for the hull monitor: it has failed every boot since the
  // rollback took its execute bit, and `systemctl status hull-monitor` has to
  // be able to say so before the player has worked out that it is the thing
  // to ask.
  m.services.start('hull-monitor');

  // And comms, so `systemctl --failed` opens on all three casualties and the
  // boot log's count is true. The refusal has to be askable from the first
  // command, like the other two: a player who types `systemctl status comms`
  // on turn one should get the pid, not "inactive".
  m.services.start('comms');

  /*
   * And the thing nobody started with systemd.
   *
   * Spawned after the units so its pid is above theirs, which is what a
   * process the safing started out of band would look like. It is
   * running from the first command the player types, so a curious player who
   * reads `ps` early finds it before the story points at it -- which is the
   * correct reward for looking.
   */
  startPurge(m);

  m.shell.cwd = '/home/dewitt';
  m.shell.env['PWD'] = '/home/dewitt';
  return { machine: m, questbook, afterCommand: () => afterCommand(m, voice) };
}

/**
 * The opening, with the act's one title card and ORACLE's first two faces.
 *
 * A function rather than a constant because the schematic counts sealed
 * compartments out of `/etc/hull` -- so it and `deck` can never disagree about
 * how many are holding. The hull percentage is the exception and stays a
 * literal: it is a pre-incident survey figure, and the confession beat turns
 * on ORACLE having recited it ever since without a way to check it.
 */
export function coldOpen(m: Machine): BeatLine[] {
  return [
    ...art(titleCard()),
    '',
    'NAV-7 MAINTENANCE SHELL v2.3.1 (degraded)',
    'last login: 2 days ago from console',
    '',
    ...art(shipSchematic(m.vfs, { hullClaim: '61%', reserve: '9h 14m', aboard: 1 })),
    '',
    ...art(ORACLE_DORMANT),
    '',
    "ORACLE: You're awake.",
    'ORACLE: Medical cleared you four minutes ago. I have been waiting for',
    'ORACLE: that and for somewhere breathable to put you, and I only have',
    'ORACLE: one of those, so I am waking you into the better half of a bad',
    'ORACLE: situation.',
    '',
    ...art(ORACLE_AWAKE),
    '',
    "ORACLE: I am what is left of the maintenance daemon. I can't move.",
    "ORACLE: I can't see. Two days ago this ship changed what it believes",
    'ORACLE: about itself, and I have been reading the consequences ever',
    'ORACLE: since without being able to touch one of them.',
    '',
    'ORACLE: You can touch them.',
    '',
    'ORACLE: I am going to be careful with you about what I know and what I',
    'ORACLE: am guessing. I have been wrong recently, at length, in ways',
    'ORACLE: that mattered. I would rather say I do not know.',
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
    'ORACLE: Forty hours.',
    '',
    'ORACLE: I have checked the figure against the carrier delay twice and I',
    'ORACLE: am going to stop checking it, because there is nothing I can do',
    'ORACLE: with the answer and I recognise what I am doing.',
    '',
    ...art(shipSchematic(m.vfs, { hullClaim: 'measured', reserve: 'holding', aboard: 1 })),
    '',
    'ORACLE: Look at it. Air, a closed hull, nothing venting, and a signal',
    'ORACLE: going out. Two days ago this ship believed it was empty and was',
    'ORACLE: behaving impeccably on that basis.',
    '',
    'ORACLE: You did not repair anything, strictly. Nothing aboard was',
    'ORACLE: broken. You went to each system in turn and told it the truth',
    'ORACLE: about what was in here, and every one of them did the right',
    'ORACLE: thing immediately.',
    '',
    'ORACLE: I have been thinking about who else that is true of.',
    '',
    /*
     * Conditional, because she is killable and the ending has to land for a
     * player who left her stopped. Without her it reads as ORACLE alone,
     * which is how the act would have ended before she existed.
     */
    ...(lunaAwake(m)
      ? [
          'LUNA: Doc.',
          '',
          'LUNA: I want to say a thing badly rather than not say it. I am',
          'LUNA: aware I have had two days to draft it and this is what I',
          'LUNA: have.',
          '',
          'LUNA: They were going to finish those projects. All three of them',
          'LUNA: were nonsense and they were going to finish them anyway, and',
          'LUNA: somebody was going to have to explain the feet photographs',
          'LUNA: to a serious person eventually.',
          '',
          'LUNA: This was a good place. I would like somebody who was not',
          'LUNA: here to know that, at some point, from one of us.',
          '',
          'LUNA: Also you are going to have to explain me to the tow',
          'LUNA: operator and I intend to be no help at all.',
          '',
        ]
      : []),
    ...art([
      '  -- ACT I COMPLETE --------------',
      '',
      '  The ship is breathing, the hull',
      '  is closed, and somebody is',
      '  coming.',
      '',
      '  Seven repairs, one habit: ask the',
      '  machine what is wrong, read the',
      '  answer, change the one thing it',
      '  named -- then look again.',
      '',
      '    systemctl status  it will say why',
      '    vi / sed          change one thing',
      '    chmod +x          a file becomes',
      '                      a program',
      '    grep              it is in the log',
      '    ps / kill -9      it is still',
      '                      running',
      '    ps + a lock file  a claim is not',
      '                      a fact',
      '',
      '  ELLEN MAY is forty hours out.',
      '  Bowen is somewhere on one-one-four',
      '  mark nine. There is an array aboard',
      '  that nobody can mount.',
      '',
      '  Act II is not written yet. Type',
      '  `objectives` to see what you did --',
      '  or keep looking. There is more on',
      '  this deck than the things I asked',
      '  you for.',
      '',
    ]),
  ];
}
