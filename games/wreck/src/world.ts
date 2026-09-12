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
      '[0000.884] scrubber: FAIL - configuration rejected',
      '[0001.002] atmosphere: O2 below crew minimum',
      '[0001.310] comms: no carrier',
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
      'The scrubber will not start. Ask it why yourself:',
      '',
      '    systemctl status scrubber',
      '',
      'It will tell you the number it objects to. That number lives in a',
      "config file over in /etc -- that is where this ship keeps every",
      'setting it has. Look for yourself:',
      '',
      '    ls /etc',
      '',
      'Open the life support one and put the number back into the range it',
      'wants. Any editor on board will do:',
      '',
      '    vi /etc/life_support.conf      (:wq to save and quit)',
      '    nano /etc/life_support.conf    (^O to save, ^X to quit)',
      '',
      'Then start the service. That part needs sudo.',
      '',
      'I set the target low to stretch the reserve. The controller has',
      'refused it ever since and I have had a long time to think about',
      'whether that was clever of me.',
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
  "ORACLE: You're awake. Good. I'm what's left of the maintenance",
  "ORACLE: daemon. I can't move, I can't see, and I can't fix",
  "ORACLE: anything myself.",
  'ORACLE: You can. Start with: ls',
  'ORACLE: There is a note in your home directory. Read it: cat README',
  "ORACLE: Lost? Type: hint. It costs nothing and I do not keep score.",
  '',
];
