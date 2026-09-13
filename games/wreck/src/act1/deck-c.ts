import { ROOT_USER, type Vfs } from '@sigkill/machine';

/**
 * Deck C, as the crew left it.
 *
 * Everything here is either a lead, a lesson, or a person. A file that is none
 * of those three is furniture, and furniture is how a world stops being worth
 * exploring -- the player learns that looking around does not pay, and then
 * they stop looking around, and then it is not an adventure any more.
 *
 * The strongest teaching device on the deck is `.bash_history`. It shows real
 * commands in the hands of somebody who had a reason to type them, which is
 * the only way anyone has ever actually learned a shell. Every command in
 * Vasquez's history runs aboard, including the ones that are a step ahead of
 * where the player currently is.
 */

/** Everyone who had an account. `ls -l` reads these names out of /etc/passwd. */
export const CREW = {
  root: 0,
  survivor: 1000,
  vasquez: 1001,
  chen: 1002,
  bowen: 1003,
  okonkwo: 1004,
} as const;

/** Where the hull sensor sweep lives, and the reason it has not run. */
export const HULL_CHECK = '/usr/local/bin/hull-check';

/** The compartment that is open. Objectives read this; nothing hard-codes it twice. */
export const BREACHED = 'c7';

function file(vfs: Vfs, path: string, lines: string[], opts: { uid?: number; mode?: number } = {}): void {
  vfs.writeText(path, lines.join('\n'), ROOT_USER);
  if (opts.mode !== undefined) vfs.chmod(path, opts.mode, ROOT_USER);
  if (opts.uid !== undefined) vfs.chown(path, opts.uid, opts.uid, ROOT_USER);
}

/**
 * The nine compartments of deck C.
 *
 * Eight are sealed. One is the hole Chen says they could have closed in an
 * afternoon.
 */
const COMPARTMENTS: ReadonlyArray<{ id: string; name: string; sealed: boolean }> = [
  { id: 'c1', name: 'forward stores', sealed: true },
  { id: 'c2', name: 'crew quarters', sealed: true },
  { id: 'c3', name: 'galley', sealed: true },
  { id: 'c4', name: 'medical', sealed: true },
  { id: 'c5', name: 'engineering access', sealed: true },
  { id: 'c6', name: 'coolant loop', sealed: true },
  { id: 'c7', name: 'aft maintenance crawl', sealed: false },
  { id: 'c8', name: 'pod bay', sealed: true },
  { id: 'c9', name: 'reactor shield', sealed: true },
];

/**
 * A tiny linear congruential generator.
 *
 * The telemetry needs to look like instrument noise and be byte-identical on
 * every machine that boots this world, which rules out Math.random for the
 * same reason the Machine rules it out: a save that replays differently is
 * not a save.
 */
function noise(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

/** `YYYY-MM-DDTHH:MM`, which sorts correctly as plain text and greps cleanly. */
function stamp(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number): string => String(n).padStart(2, '0');
  return (
    `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}` +
    `T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`
  );
}

/**
 * Ten days of hull pressure telemetry: 540 lines, deliberately too many to read.
 *
 * This is the file that teaches search. A player who tries to `cat` it learns
 * why nobody cats a log, and every route out of that is a real skill:
 *
 *     grep PRESSURE_DROP /var/log/hull.log
 *     grep -c PRESSURE_DROP /var/log/hull.log
 *     grep PRESSURE_DROP /var/log/hull.log | cut -d' ' -f2 | sort | uniq -c
 *     tail -20 /var/log/hull.log
 *
 * The last of those matters: C2 was dropping too, until Vasquez patched it on
 * day five. So the count says two compartments have leaked and only the dates
 * say which one still is. Reading a log is not finding a word in it.
 */
function hullTelemetry(wakeMs: number): string[] {
  const rng = noise(0x5e41);
  const rows: string[] = [];
  const step = 4 * 60 * 60 * 1000;
  const samples = 60;
  const start = wakeMs - samples * step;

  for (let i = 0; i < samples; i++) {
    const at = stamp(start + i * step);
    // How far through the window we are, for the compartment that is losing air.
    const progress = i / (samples - 1);

    for (const { id } of COMPARTMENTS) {
      const label = id.toUpperCase();
      const jitter = (rng() - 0.5) * 0.4;

      if (id === BREACHED) {
        // Still falling, and the whole point is that it has never stopped.
        const kpa = 99.1 - progress * 3.2 + jitter;
        rows.push(`${at} ${label} ${kpa.toFixed(1)}kPa PRESSURE_DROP`);
        continue;
      }

      if (id === 'c2' && i < 8) {
        // The decoy: real, historical, and fixed. Vasquez patched it.
        const kpa = 100.1 + jitter;
        rows.push(`${at} ${label} ${kpa.toFixed(1)}kPa PRESSURE_DROP`);
        continue;
      }

      const kpa = 101.3 + jitter;

      // A sensor that drops out now and then, so that "unusual" and "broken"
      // are not the same word. C6 is noise, not a hole.
      if (id === 'c6' && i % 17 === 3) {
        rows.push(`${at} ${label} ---- SENSOR_FAULT`);
        continue;
      }

      // The galley hatch gets used. Nothing is wrong with the galley.
      if (id === 'c3' && (i === 12 || i === 41)) {
        rows.push(`${at} ${label} ${kpa.toFixed(1)}kPa HATCH_CYCLE`);
        continue;
      }

      rows.push(`${at} ${label} ${kpa.toFixed(1)}kPa OK`);
    }
  }

  rows.push('');
  return rows;
}

/**
 * Quarters, accounts, the hull configuration and ten days of telemetry.
 *
 * Called once, during boot, before any service starts -- the hull monitor's
 * precondition reads files this writes.
 */
export function seedDeckC(vfs: Vfs, wakeMs: number): void {
  for (const dir of [
    '/home/vasquez', '/home/vasquez/notes',
    '/home/chen', '/home/bowen',
    '/etc/hull', '/mnt/deck-c', '/usr/local/bin',
  ]) {
    vfs.mkdirp(dir, ROOT_USER);
  }
  vfs.chown('/home/vasquez', CREW.vasquez, CREW.vasquez, ROOT_USER);
  vfs.chown('/home/vasquez/notes', CREW.vasquez, CREW.vasquez, ROOT_USER);
  vfs.chown('/home/chen', CREW.chen, CREW.chen, ROOT_USER);
  vfs.chown('/home/bowen', CREW.bowen, CREW.bowen, ROOT_USER);

  // -------------------------------------------------------------- accounts
  // `ls -l /home` reads these. Four names and one of them is still logging in
  // is a faster way to explain what happened here than any paragraph.

  file(vfs, '/etc/passwd', [
    'root:x:0:0:root:/root:/bin/sh',
    `survivor:x:${CREW.survivor}:${CREW.survivor}:cold sleep berth 3:/home/survivor:/bin/sh`,
    `vasquez:x:${CREW.vasquez}:${CREW.vasquez}:R. Vasquez, engineering:/home/vasquez:/bin/sh`,
    `chen:x:${CREW.chen}:${CREW.chen}:M. Chen, medical:/home/chen:/bin/sh`,
    `bowen:x:${CREW.bowen}:${CREW.bowen}:T. Bowen, navigation:/home/bowen:/bin/sh`,
    `okonkwo:x:${CREW.okonkwo}:${CREW.okonkwo}:A. Okonkwo, cargo:/home/okonkwo:/bin/sh`,
    '',
  ], { mode: 0o644 });

  file(vfs, '/etc/group', [
    'root:x:0:',
    `survivor:x:${CREW.survivor}:`,
    `engineering:x:${CREW.vasquez}:survivor`,
    `medical:x:${CREW.chen}:`,
    `navigation:x:${CREW.bowen}:`,
    `cargo:x:${CREW.okonkwo}:`,
    '',
  ], { mode: 0o644 });

  // ------------------------------------------------------------- Vasquez
  // Engineering. The person whose job the player has inherited.

  file(vfs, '/home/vasquez/.bash_history', [
    'cat /etc/life_support.conf',
    'systemctl status scrubber',
    'man systemctl',
    'vi /etc/life_support.conf',
    'systemctl status scrubber',
    'sudo systemctl start scrubber',
    'sudo systemctl start scrubber',
    'sudo systemctl start scrubber',
    'grep -i fail /var/log/boot.log',
    'cat /etc/hull/c7.conf',
    'ls -l /usr/local/bin/hull-check',
    'sudo systemctl start hull-monitor',
    'systemctl status hull-monitor',
    'grep C7 /var/log/hull.log | tail -20',
    "grep PRESSURE_DROP /var/log/hull.log | cut -d' ' -f2 | sort | uniq -c",
    'chmod +x /home/vasquez/notes/seal.sh',
    './notes/seal.sh c2',
    'ls -l /home/vasquez/notes/',
    'echo "not tonight" >> /home/vasquez/notes/todo',
    '',
  ], { uid: CREW.vasquez, mode: 0o644 });

  file(vfs, '/home/vasquez/notes/todo', [
    '[x] reroute deck C power through the reactor bus',
    '[x] stop the coolant alarm waking everyone at 0300',
    '[x] teach chen to use grep so she stops asking me',
    '[x] patch C2. bowen was sleeping under it',
    '[ ] SEAL C7. it is the whole problem. stop putting it off',
    '[ ] scrubber target -- it refuses 16 and it is right',
    '[ ] hull-check lost its mode bits in the restore. put them back',
    '[ ] write down how any of this works for whoever is next',
    '[ ] apologise to bowen',
    '',
    'not tonight',
    '',
  ], { uid: CREW.vasquez, mode: 0o644 });

  file(vfs, '/home/vasquez/notes/scrubber-notes.txt', [
    'SCRUBBER, for whoever reads this',
    '',
    'It is a dumb machine and it is honest, which is more than I can say',
    'for the reactor. It reads /etc/life_support.conf once, at start, and',
    'it will not start on a target outside 19-23. That is not a bug. It is',
    'the one safety interlock nobody disabled.',
    '',
    'Two different things:',
    '',
    '  systemctl start scrubber    runs it NOW, this once',
    '  systemctl enable scrubber   runs it at every boot, forever after',
    '',
    'Both need sudo. Doing the first and forgetting the second is how you',
    'wake up to an alarm. Ask me how I know.',
    '',
    'If it will not start, ask it why before you touch anything:',
    '',
    '  systemctl status scrubber',
    '',
    '                                                       -- Vasquez',
    '',
  ], { uid: CREW.vasquez, mode: 0o644 });

  file(vfs, '/home/vasquez/notes/hull-notes.txt', [
    'HULL, same deal',
    '',
    'Nine compartments on this deck. One file each, under /etc/hull, and the',
    'only line that matters is SEALED. A compartment that says no is open to',
    'whatever is on the other side of it, which out here is nothing at all.',
    '',
    'hull-monitor watches them. It runs /usr/local/bin/hull-check, which is',
    'a five line script, and I restored it off the backup image on day nine',
    'after I fat-fingered the original. The backup did not keep the mode',
    'bits. A file the machine is not allowed to execute is not a program, it',
    'is a text file with opinions, so the unit has failed every boot since.',
    '',
    '  ls -l /usr/local/bin/hull-check     look at the left hand column',
    '  chmod +x /usr/local/bin/hull-check  put the x back',
    '',
    'I wrote seal.sh for the same reason. It is also not executable, because',
    'I am apparently the kind of engineer who does this twice.',
    '',
    '                                                       -- Vasquez',
    '',
  ], { uid: CREW.vasquez, mode: 0o644 });

  file(vfs, '/home/vasquez/notes/seal.sh', [
    '#!/bin/sh',
    '# Seal a hull compartment. Takes the compartment id, eg:  ./seal.sh c7',
    '#',
    '# I got tired of opening the file by hand and typing the wrong one.',
    '# Remember to chmod +x me. You will not remember to chmod +x me.',
    '',
    'sed -i "s/^SEALED=.*/SEALED=yes/" /etc/hull/$1.conf',
    'echo "sealed: $1"',
    'grep SEALED /etc/hull/$1.conf',
    '',
  ], { uid: CREW.vasquez, mode: 0o644 });

  // ---------------------------------------------------------------- Chen
  // Medical. Kept records, which is what makes the crew real.

  file(vfs, '/home/chen/crew-health.csv', [
    'day,name,o2_sat,note',
    '1,vasquez,98,baseline',
    '1,chen,99,baseline',
    '1,bowen,97,baseline',
    '1,okonkwo,98,baseline',
    '6,vasquez,96,',
    '6,chen,97,',
    '6,bowen,94,headaches',
    '6,okonkwo,95,headaches',
    '9,vasquez,93,refuses to rest',
    '9,chen,94,',
    '9,bowen,90,confused at 0400',
    '9,okonkwo,89,',
    '12,vasquez,91,',
    '12,chen,92,',
    '12,bowen,88,took the pod',
    '14,vasquez,88,',
    '14,chen,89,last entry',
    '',
  ], { uid: CREW.chen, mode: 0o644 });

  file(vfs, '/home/chen/last-entry.txt', [
    'Day 14.',
    '',
    'Okonkwo yesterday. Quietly, in her sleep, which is the only mercy',
    'this ship has offered anyone.',
    '',
    'Vasquez is still down in engineering. She has not slept in three days',
    'and she will not talk about C7. I think she believes that if she seals',
    'it she is admitting the rest of it is real.',
    '',
    'I have told her the numbers. She can read them better than I can.',
    '',
    'If anyone finds this: the ship is fine. The ship was always fine. It',
    'was four people in a room built for forty and a hole we could have',
    'closed in an afternoon.',
    '',
    '                                                          -- Chen',
    '',
  ], { uid: CREW.chen, mode: 0o644 });

  // -------------------------------------------------------------- Bowen
  // Navigation. Left. The thread that pulls into the rest of the game.

  file(vfs, '/home/bowen/pod-manifest.txt', [
    'ESCAPE POD 2 -- MANIFEST (handwritten, scanned)',
    '',
    '  2x emergency ration case',
    '  1x medical kit (taken from chen, ask her)',
    '  1x nav slate, charged',
    '  1x hull patch kit  <-- I KNOW. I know.',
    '',
    'Heading: 114 mark 9. There is a relay station out there or there is',
    'not. If there is I will come back with people. If there is not then',
    'it did not matter what I took.',
    '',
    'Vasquez: seal C7. You keep saying you will.',
    '',
    '                                                          -- Bowen',
    '',
  ], { uid: CREW.bowen, mode: 0o644 });

  // ------------------------------------------------------------ the hull

  for (const { id, name, sealed } of COMPARTMENTS) {
    file(vfs, `/etc/hull/${id}.conf`, [
      `# compartment ${id.toUpperCase()} -- ${name}`,
      `NAME=${name}`,
      `SEALED=${sealed ? 'yes' : 'no'}`,
      `LAST_INSPECTED=day ${sealed ? 3 : 9}`,
      '',
    // Writable by the crew on purpose: a hatch you cannot close without the
    // root password is a hatch that kills somebody. The lesson lives in the
    // monitor's mode bits, not here.
    ], { mode: 0o666 });
  }

  vfs.writeText('/var/log/hull.log', hullTelemetry(wakeMs).join('\n'), ROOT_USER);
  vfs.chmod('/var/log/hull.log', 0o644, ROOT_USER);

  /*
   * The sensor sweep, missing its execute bit.
   *
   * It is a real script and it really is what the unit runs, so the failure a
   * player sees is the genuine one: the kernel will not execute a file that
   * nobody said was a program. `chmod +x` is not a magic word here, it is the
   * fix. Running it by hand afterwards prints the newest sample for all nine
   * compartments, which is a second honest route to the answer for a player
   * who would rather use a tool than search a log.
   */
  file(vfs, HULL_CHECK, [
    '#!/bin/sh',
    '# NAV-7 hull sensor sweep. Started by hull-monitor.service.',
    '#',
    '# Restored from the day-9 backup image. The backup did not keep the mode',
    '# bits, so this has not run since. -- Vasquez',
    '',
    'echo "hull-check: sweeping 9 compartments"',
    'tail -9 /var/log/hull.log',
    'echo "hull-check: ten days of history in /var/log/hull.log"',
    '',
  ], { mode: 0o644 });

  file(vfs, '/etc/systemd/system/hull-monitor.service', [
    '[Unit]',
    'Description=Hull integrity monitor',
    'After=reactor.service',
    '',
    '[Service]',
    `ExecStart=${HULL_CHECK} --watch`,
    'Restart=on-failure',
    '',
    '[Install]',
    'WantedBy=multi-user.target',
    '',
  ]);

  file(vfs, '/mnt/deck-c/README', [
    'DECK C -- maintenance, engineering access, aft crawl',
    '',
    'Compartment configuration is under /etc/hull. One file per compartment.',
    'A compartment that is not sealed is open to whatever is on the other',
    'side of it.',
    '',
    'Pressure telemetry goes to /var/log/hull.log. It is five hundred and',
    'forty lines long. Do not read it. Search it:',
    '',
    '    grep PRESSURE_DROP /var/log/hull.log',
    '    grep -c PRESSURE_DROP /var/log/hull.log',
    '',
    'And if you want to know which compartments, rather than how many lines,',
    'take the second field off each match and count what is left:',
    '',
    "    grep PRESSURE_DROP /var/log/hull.log | cut -d' ' -f2 | sort | uniq -c",
    '',
    'Two of them have dropped. Only one of them still is. Dates, not counts.',
    '',
  ]);

  file(vfs, '/etc/motd', [
    'NAV-7 -- Kepler-Vance Salvage & Recovery',
    'Unauthorised access is logged. There is no one left to read the log.',
    '',
  ]);
}
