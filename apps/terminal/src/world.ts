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
      'The scrubber will not start because someone set the oxygen target',
      'to a number the controller refuses. Look in /etc. Fix the number.',
      'Then start the service.',
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
