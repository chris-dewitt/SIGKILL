import { Machine, ROOT_USER } from '@sigkill/machine';

/**
 * The opening state of NAV-7 — Act I, Deck C.
 *
 * Temporary: this lives here only until the content pipeline exists. It will
 * move to games/wreck as an authored world snapshot, at which point this file
 * goes away rather than growing.
 */
export function bootWreck(): Machine {
  const m = new Machine({ hostname: 'nav7', track: 'operator' });
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
      "If you are reading this, the ship woke you and not me.",
      '',
      'The scrubber will not start. I set the oxygen target low to stretch',
      'the reserve and the controller has refused it ever since. It will tell',
      'you what it wants if you ask it properly:',
      '',
      '    systemctl status scrubber',
      '',
      'Fix the number in /etc, then start the service. You will need sudo.',
      '',
      '  - Vasquez, engineering',
      '',
    ].join('\n'),
    ROOT_USER,
  );
  v.chown('/home/survivor/README', 1000, 1000, ROOT_USER);

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
  m.setPrecondition('scrubber', (vfs) => {
    const conf = vfs.readText('/etc/life_support.conf', ROOT_USER);
    const target = Number(/O2_TARGET=(\d+(?:\.\d+)?)/.exec(conf)?.[1] ?? NaN);
    if (!Number.isFinite(target)) {
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
  return m;
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
  '',
];
