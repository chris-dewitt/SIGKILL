import { Machine, ROOT_USER, type Track } from '@sigkill/machine';
import { editorCommands } from '@sigkill/editor';
import { Questbook, questCommands } from '@sigkill/quest';
import { oxygenTarget, WRECK_OBJECTIVES } from './objectives.js';

export interface WreckOptions {
  /** Which manual voice and hint ladder the player gets. */
  track?: Track;
}

export interface Wreck {
  machine: Machine;
  /** Objectives and hint state, so a save can carry both. */
  questbook: Questbook;
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
    track,
    commands: [...questCommands(questbook, { speaker: 'ORACLE' }), ...editorCommands()],
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
      '[0001.310] comms: no carrier',
      '[0001.900] init: 1 unit failed. See: systemctl status scrubber',
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
      'I set the target low to stretch the reserve. I thought I was buying',
      'us weeks. The controller refused it inside of a second and I spent',
      'eleven years deciding whether to be grateful.',
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

  v.writeText('/etc/crew.csv', 'vasquez,engineering,deceased\nchen,medical,deceased\nbowen,navigation,unknown\n', ROOT_USER);

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

  // Authored by the adventure, never by the Machine: a real atmosphere
  // controller refuses a target outside the breathable band, and says why.
  // It reads the number through the same helper the objectives do, so the
  // hint and the refusal can never disagree about what counts as breathable.
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

  m.shell.cwd = '/home/survivor';
  m.shell.env['PWD'] = '/home/survivor';
  return { machine: m, questbook };
}

export const COLD_OPEN = [
  'NAV-7 MAINTENANCE SHELL v2.3.1 (degraded)',
  'last login: 4,112 days ago from console',
  '',
  '  hull integrity ......... 61%',
  '  O2 reserve ............. 9h 14m',
  '  crew aboard ............ 1',
  '',
  "ORACLE: You're awake.",
  'ORACLE: I did not expect that. I want to be careful about how much',
  'ORACLE: I expect, now.',
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
  'ORACLE: If you get lost, type: hint. It costs nothing. I am not',
  'ORACLE: keeping score. I stopped keeping score a long time ago.',
  '',
];

/**
 * What ORACLE says when the act is finished.
 *
 * Act I ended in silence before this: both objectives would go green and
 * nothing would happen, which is why a playthrough felt like it stopped
 * rather than ended.
 */
export const EPILOGUE = [
  '',
  'ORACLE: It is running.',
  '',
  'ORACLE: I want to tell you something and I am not certain it is',
  'ORACLE: appropriate, so I will say it quickly and then we can both',
  'ORACLE: pretend I did not.',
  '',
  'ORACLE: Vasquez tried that fix on day nine. The same number. She',
  'ORACLE: typed it, the controller refused her, and she wrote in her',
  'ORACLE: log that it was not wrong. Then the shift ended and she did',
  'ORACLE: not come back to it.',
  '',
  'ORACLE: I have had eleven years to work out why. I think she knew',
  'ORACLE: that starting it meant deciding who the air was for. There',
  'ORACLE: were four of them then.',
  '',
  'ORACLE: There is one of you. So the arithmetic is easier, and I am',
  'ORACLE: sorry that it is.',
  '',
  'ORACLE: It will hold now. Even if the power browns out tonight, it',
  'ORACLE: will come back without you. I made certain of that when you',
  'ORACLE: enabled it, and I have not been able to make certain of',
  'ORACLE: anything for a very long time.',
  '',
  '  ── ACT I COMPLETE ──────────────────────────────────',
  '',
  '  The ship is breathing.',
  '',
  '  Deck C is sealed and there are three more decks.',
  '  Bowen took a pod and did not say where.',
  '',
  '  Act II is not written yet. Type `objectives` to see',
  '  what you did, or keep looking around -- there is more',
  '  on this deck than the scrubber.',
  '',
];
