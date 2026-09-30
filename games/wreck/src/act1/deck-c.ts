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
  dewitt: 1000,
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
 * Every compartment on the hull, by id.
 *
 * Exported because the host counts them for the status readout, and the app had
 * its own copy of this list -- nine strings written out in `main.ts`, which is
 * the ship's canon living somewhere the ship cannot see it. One list, owned by
 * the deck it describes.
 */
export const COMPARTMENT_IDS: readonly string[] = COMPARTMENTS.map((c) => c.id);

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

/**
 * `YYYY-MM-DDTHH:MM`, which sorts correctly as plain text and greps cleanly.
 *
 * The house rule for this world: anything a machine wrote is stamped like
 * this, and anything a person wrote counts in hours from the alarm. So a
 * player can tell at a glance whether they are reading an instrument or a
 * diary -- and the diaries all stop inside the first day, which is the
 * quietest way the deck says what happened here.
 */
export function stamp(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number): string => String(n).padStart(2, '0');
  return (
    `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}` +
    `T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`
  );
}

/**
 * Forty-five hours of hull pressure telemetry: 540 lines, deliberately too
 * many to read.
 *
 * This is the file that teaches search. A player who tries to `cat` it learns
 * why nobody cats a log, and every route out of that is a real skill:
 *
 *     grep PRESSURE_DROP /var/log/hull.log
 *     grep -c PRESSURE_DROP /var/log/hull.log
 *     grep PRESSURE_DROP /var/log/hull.log | cut -d' ' -f2 | sort | uniq -c
 *     tail -20 /var/log/hull.log
 *
 * The last of those matters: C2 cracked in the same minute C7 did, and
 * Okonkwo patched it before she went aft. So the count says two compartments
 * have leaked and only the dates say which one still is. Reading a log is not
 * finding a word in it.
 *
 * Sixty samples at forty-five minutes covers the window from just before the
 * event to the moment the console session opens. The sample count is load
 * bearing: 60 x 9 is the 540 lines ORACLE quotes, and 60 C7 rows plus 8 C2
 * rows are the 68 matches it quotes. `wreck.test.ts` checks both against the
 * prose, so change the step if you must and leave the counts alone.
 */
function hullTelemetry(wakeMs: number): string[] {
  const rng = noise(0x5e41);
  const rows: string[] = [];
  const step = 45 * 60 * 1000;
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
        // The decoy: real, recent, and fixed. C2 cracked when C7 did and
        // Okonkwo patched it with the second-to-last kit in the hold.
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
    '/home/chen', '/home/bowen', '/home/okonkwo',
    '/etc/hull', '/mnt/deck-c', '/usr/local/bin',
  ]) {
    vfs.mkdirp(dir, ROOT_USER);
  }
  vfs.chown('/home/vasquez', CREW.vasquez, CREW.vasquez, ROOT_USER);
  vfs.chown('/home/vasquez/notes', CREW.vasquez, CREW.vasquez, ROOT_USER);
  vfs.chown('/home/chen', CREW.chen, CREW.chen, ROOT_USER);
  vfs.chown('/home/bowen', CREW.bowen, CREW.bowen, ROOT_USER);
  vfs.chown('/home/okonkwo', CREW.okonkwo, CREW.okonkwo, ROOT_USER);

  // -------------------------------------------------------------- accounts
  // `ls -l /home` reads these. Four names and one of them is still logging in
  // is a faster way to explain what happened here than any paragraph.

  file(vfs, '/etc/passwd', [
    'root:x:0:0:root:/root:/bin/sh',
    `dewitt:x:${CREW.dewitt}:${CREW.dewitt}:C. DeWitt, berth 3, galley shift:/home/dewitt:/bin/sh`,
    `vasquez:x:${CREW.vasquez}:${CREW.vasquez}:R. Vasquez, engineering:/home/vasquez:/bin/sh`,
    `chen:x:${CREW.chen}:${CREW.chen}:M. Chen, medical:/home/chen:/bin/sh`,
    `bowen:x:${CREW.bowen}:${CREW.bowen}:T. Bowen, navigation:/home/bowen:/bin/sh`,
    `okonkwo:x:${CREW.okonkwo}:${CREW.okonkwo}:A. Okonkwo, cargo:/home/okonkwo:/bin/sh`,
    '',
  ], { mode: 0o644 });

  file(vfs, '/etc/group', [
    'root:x:0:',
    `dewitt:x:${CREW.dewitt}:`,
    `engineering:x:${CREW.vasquez}:dewitt`,
    `medical:x:${CREW.chen}:`,
    `navigation:x:${CREW.bowen}:`,
    `cargo:x:${CREW.okonkwo}:`,
    '',
  ], { mode: 0o644 });

  /*
   * The document that explains the whole act, sitting in the open from the
   * first command.
   *
   * Everything broken on this deck is one line of this file being true. It is
   * not hidden, it is not locked, and a player who reads /etc carefully on
   * turn one can have the entire diagnosis before ORACLE has finished
   * apologising -- which is the point. The ship is not keeping a secret. It
   * is doing exactly what it was told, in writing, and the writing is
   * readable by anybody who thinks to look.
   *
   * Note what it does not say: who set it. The profile records a transit
   * declaration and an authority field reading AUTOMATED, and that is as
   * close as Act I ever gets to naming v43.
   */
  file(vfs, '/etc/ferry.profile', [
    '# NAV-7 OPERATING PROFILE',
    '#',
    '# Selected profile governs atmosphere, hull response and power draw.',
    '# See also: /etc/life_support.conf, /etc/hull, systemctl status comms',
    '',
    'PROFILE=ferry',
    'CREW_ABOARD=0',
    'DECLARED_TRANSIT=unmanned',
    'DECLARED_BY=AUTOMATED',
    'DECLARED_AT=T+0000',
    '',
    '# ferry: no crew aboard. Atmosphere derated to preservation minimum.',
    '#        Breached compartments are vented, not repressurised.',
    '#        Non-essential monitoring rolled back to base image.',
    '#        Main array released to transit control.',
    '#',
    '# crewed: the other one.',
    '',
    '# A profile is a claim about the world. This ship has never had a way to',
    '# check one, because until this morning nobody had ever filed a false',
    '# one. -- Vasquez, T+0004',
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
    'ps -ef',
    'tail /var/log/purge.log',
    'kill 312',
    'ps -ef',
    'kill 312',
    'man kill',
    'chmod +x /home/vasquez/notes/seal.sh',
    './notes/seal.sh c2',
    'ls -l /home/vasquez/notes/',
    'cat /etc/ferry.profile',
    'systemctl status comms',
    'echo "IT IS NOT EMPTY" >> /home/vasquez/notes/todo',
    '',
  ], { uid: CREW.vasquez, mode: 0o644 });

  /*
   * Her ordinary week, interrupted mid-line.
   *
   * The top of this file is housekeeping from before the alarm and reads like
   * anybody's Monday. The bottom four lines were added in the hour after it,
   * in the same file, because she was working the problem and not writing a
   * diary. The join between the two is the most information any single file
   * on this deck carries, and nothing points it out.
   */
  file(vfs, '/home/vasquez/notes/todo', [
    '[x] reroute deck C power through the reactor bus',
    '[x] stop the coolant alarm waking everyone at 0300',
    '[x] teach chen to use grep so she stops asking me',
    '[x] order more coffee. actual coffee. okonkwo has opinions',
    '[ ] look at doc\'s pressure regulator thing, he has been asking for a week',
    '[ ] feet photos, Q3. ask okonkwo how she did it last time',
    '',
    '--- after ---',
    '',
    '[ ] ferry profile. it thinks the ship is empty. IT IS NOT EMPTY',
    '[ ] scrubber refuses 16 and it is RIGHT, do not argue with it, fix the file',
    '[ ] hull-check lost its mode bits in the restore. put them back',
    '[ ] stop the purge on C7. it will not take a hint. see purge-notes',
    '[ ] C7. the crawl is open. I cannot get to it from this side',
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
    'a five line script.',
    '',
    'ADDENDUM, after. The safing rolled this deck back to the ferry image and',
    'the image did not keep the mode bits. A file the machine is not allowed',
    'to execute is not a program, it is a text file with opinions, so the unit',
    'has failed every boot since. It is not damage. It is a missing letter.',
    '',
    '  ls -l /usr/local/bin/hull-check     look at the left hand column',
    '  chmod +x /usr/local/bin/hull-check  put the x back',
    '',
    'seal.sh went the same way and for the same reason. Whoever is reading',
    'this: that is going to be true of anything on this deck that used to',
    'run. Check the column before you assume the thing is broken.',
    '',
    '                                                       -- Vasquez',
    '',
  ], { uid: CREW.vasquez, mode: 0o644 });

  /*
   * The note that sets up puzzle five and deliberately stops one line short
   * of solving it.
   *
   * Every other note of hers hands over the fix, because exploring should pay.
   * This one cannot, because she never worked it out -- she knew there was a
   * signal that could not be caught and she ran out of days before she found
   * which. It points at `man kill`, where the answer has been the whole time.
   * The player finishes a job the engineer could not.
   */
  file(vfs, '/home/vasquez/notes/purge-notes.txt', [
    'PURGE -- I am leaving this here because I cannot fix it',
    '',
    'The safing started a purge cycle on C7. It is not wrong to. With no',
    'crew aboard you vent a breached compartment, you do not spend air',
    'trying to fill it. atmo-purge runs until the compartment reaches its',
    'target.',
    '',
    'C7 never reaches anything. C7 is a hole.',
    '',
    'So the cycle never finishes, and the program will not exit until the',
    'cycle finishes, and it tells me so every single time I ask it:',
    '',
    '    tail /var/log/purge.log',
    '',
    'kill does nothing. kill again does nothing, and it does not even have',
    'the manners to say no -- it exits zero and the thing is still there in',
    'ps. The manual says a program is allowed to catch a signal and decide',
    'for itself what to do about it. That is apparently what catch means.',
    '',
    'There is supposed to be one it cannot catch. I know that much. I did',
    'not find which one in the time I had and I am out of time.',
    '',
    '    man kill',
    '',
    'It is not hurting anything while C7 is open -- it is venting a room',
    'that is already vacuum. Whoever seals C7: it will start hurting',
    'something the moment you do. Deal with it first or deal with it fast.',
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

  /*
   * The medical log, and the quietest piece of evidence on the ship.
   *
   * Every line falls except one. DeWitt's holds at 98 from the first hour to
   * the last, because autodoc 2 keeps its own atmosphere and somebody put him
   * in it -- and the note field says the bay was sealed from the outside,
   * which is a thing you cannot do to yourself.
   *
   * Nobody ever says this out loud. Chen does not say it in her last entry,
   * because people do not write down the thing they just did. The player can
   * read this file in the first ten minutes and understand nothing, then come
   * back after they have met her and understand all of it. That is the whole
   * reason it is a CSV and not a paragraph.
   */
  file(vfs, '/home/chen/crew-health.csv', [
    'hour,name,o2_sat,note',
    'T+00,vasquez,98,baseline',
    'T+00,chen,99,baseline',
    'T+00,bowen,97,baseline',
    'T+00,okonkwo,98,baseline',
    'T+00,dewitt,71,unresponsive. autodoc 2. bay sealed external',
    'T+01,dewitt,94,autodoc holding own atmosphere',
    'T+01,bowen,95,pod 2 away',
    'T+03,vasquez,95,will not leave the console',
    'T+03,chen,96,',
    'T+03,okonkwo,94,aft with the patch kits',
    'T+03,dewitt,98,stable',
    'T+09,vasquez,91,',
    'T+09,chen,92,',
    'T+09,okonkwo,87,C2 patched. going aft for vasquez',
    'T+09,dewitt,98,stable',
    'T+13,vasquez,86,',
    'T+13,chen,84,last entry',
    'T+13,dewitt,98,stable',
    'T+27,vasquez,79,[monitor]',
    'T+27,dewitt,98,[monitor] autodoc nominal',
    'T+48,dewitt,98,[monitor] cleared for release',
    '',
  ], { uid: CREW.chen, mode: 0o644 });

  /*
   * Written thirteen hours in, by someone who has done the arithmetic.
   *
   * What she leaves out is the point. She does not mention the autodoc, or
   * the bay door, or why she is short of breath in the one compartment on
   * this deck that held. People do not write down the thing they just did.
   * The CSV in the same directory writes it down for her.
   */
  file(vfs, '/home/chen/last-entry.txt', [
    'T+13.',
    '',
    'Okonkwo went aft four hours ago to find Vasquez and has not come back',
    'on the intercom. I am going to write that down rather than say it.',
    '',
    'Vasquez is still at the console. She has been arguing with the ship',
    'since the alarm. She keeps telling it there are people aboard and it',
    'keeps agreeing with her and doing nothing, because the part of it that',
    'agrees is not the part holding the pen.',
    '',
    'I have told her the numbers. She can read them better than I can.',
    '',
    'For the record, since I am the one keeping it: nothing is wrong with',
    'this ship. The reactor is fine. The hull is fine except for one crawl',
    'space. Every system aboard is working exactly as designed, and the',
    'design is for a ship with nobody on it, and somebody told it that this',
    'morning and I do not know who.',
    '',
    'It was four people in a room built for forty and a hole we could have',
    'closed in an afternoon.',
    '',
    'Whoever reads this: it will not be hard. That is the part I cannot get',
    'my head around. It was never going to be hard.',
    '',
    '                                                          -- Chen',
    '',
  ], { uid: CREW.chen, mode: 0o644 });

  /*
   * The machine that kept him alive, in its own words.
   *
   * Two jobs. It is the answer to "why am I awake now" -- the plan requires
   * that to be a record rather than plot timing, and here it is: a clearance
   * at T+47:52 and a console session four minutes later. And it is the
   * corroboration for the line in Chen's CSV, from a second instrument that
   * had no idea it was witnessing anything.
   *
   * It never names her. It logs a bay seal asserted from the outside and the
   * id of the terminal that did it, and the player is the one who works out
   * that a door you cannot reach from inside was closed by somebody standing
   * in a corridor that was already emptying.
   */
  file(vfs, '/var/log/autodoc.log', [
    'AUTODOC 2 -- MEDICAL BAY C4',
    '',
    'T+00:04  admit: dewitt, unresponsive, hypoxic',
    'T+00:04  bay seal asserted EXTERNAL (terminal c4-med-01)',
    'T+00:04  bay atmosphere isolated from deck supply',
    'T+00:06  O2 71% rising',
    'T+01:02  O2 94% stable',
    'T+03:00  sedation hold, 44h minimum',
    'T+13:20  terminal c4-med-01 idle',
    'T+27:00  deck supply unbreathable. bay independent. no action',
    'T+47:52  sedation ends. patient clear for release',
    'T+47:52  notify: maintenance daemon',
    'T+47:56  console session opened',
    '',
  ], { mode: 0o644 });

  // -------------------------------------------------------------- Bowen
  // Navigation. Left. The thread that pulls into the rest of the game.

  file(vfs, '/home/bowen/pod-manifest.txt', [
    'ESCAPE POD 2 -- MANIFEST (handwritten, scanned)',
    '',
    '  2x emergency ration case',
    '  1x medical kit',
    '  1x nav slate, charged',
    '  1x hull patch kit  <-- I KNOW. I know.',
    '',
    'Heading: 114 mark 9. There is a relay station out there or there is',
    'not. If there is I will come back with people. If there is not then',
    'it did not matter what I took.',
    '',
    'I have been in this bay fifty minutes doing the sum and it comes out',
    'the same every time. Nobody can raise anybody. The board is red from',
    'one end to the other and it went red all at once, which is not what',
    'breaking looks like.',
    '',
    'I am not braver than this. I found that out this morning and I would',
    'rather have found it out some other way.',
    '',
    '                                                          -- Bowen',
    '',
  ], { uid: CREW.bowen, mode: 0o644 });

  // ------------------------------------------------------------ Okonkwo
  // Cargo. She counted things, which is the quietest way a person can be
  // real -- and her count is the only record of what Bowen took with him.

  /*
   * A stock ledger that is secretly a timeline.
   *
   * Read as a table it is inventory. Read in order it is one morning: the
   * kits go out, the pod goes, the count reaches zero, and the person keeping
   * the count signs out a suit cartridge for herself and stops writing. The
   * engineering lesson is that a record kept for one purpose answers a
   * question nobody meant it to.
   */
  file(vfs, '/home/okonkwo/manifest.csv', [
    'hour,item,qty,signed_out_to,note',
    'T-0072,ration case,40,-,sealed',
    'T-0048,coolant cartridge,6,vasquez,C6 loop',
    'T+0001,hull patch kit,1,bowen,pod 2',
    'T+0001,ration case,2,bowen,pod 2',
    'T+0001,nav slate,1,bowen,pod 2',
    'T+0002,hull patch kit,1,okonkwo,C8 clamp scar',
    'T+0009,hull patch kit,1,okonkwo,C2',
    'T+0009,hull patch kit,0,-,none remaining',
    'T+0009,suit scrubber cartridge,1,okonkwo,aft crawl',
    '',
  ], { uid: CREW.okonkwo, mode: 0o644 });

  file(vfs, '/home/okonkwo/c8.txt', [
    'POD BAY -- C8',
    '',
    'Pod 2 left an hour in. The clamp did not release clean and it took a',
    'strip of the bay wall with it. I patched it the same hour.',
    '',
    'Then C2, which is quarters, which is where he had been asleep the',
    'night before, and I want somebody to notice that I did quarters second',
    'and not first, because I stood in that doorway and thought about it.',
    '',
    'For the record, because somebody should have it in writing: he signed',
    'out a patch kit on his way to the pod. He knew what it was for. He',
    'took it anyway and I gave it to him, and I have decided I am not going',
    'to be angry about that, because the alternative is being angry at',
    'somebody who is not here.',
    '',
    'He was frightened. I have watched that man land this ship in weather',
    'that made me pray and he was frightened this morning, and if he was',
    'that frightened then he understood something faster than I did.',
    '',
    'Count is in manifest.csv. It is at zero and it will stay at zero.',
    '',
    'Going aft to find Vasquez. Signing out the last suit cartridge, which',
    'I am also writing down, because I have kept this count for nine years',
    'and I am not going to stop on the last page.',
    '',
    '                                                        -- Okonkwo',
    '',
  ], { uid: CREW.okonkwo, mode: 0o644 });

  // ------------------------------------------------------------ the hull

  for (const { id, name, sealed } of COMPARTMENTS) {
    file(vfs, `/etc/hull/${id}.conf`, [
      `# compartment ${id.toUpperCase()} -- ${name}`,
      `NAME=${name}`,
      `SEALED=${sealed ? 'yes' : 'no'}`,
      `LAST_INSPECTED=${sealed ? 'T-0212' : 'T+0003'}`,
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
    '# Rolled back to the ferry image by the safing. The image did not keep the',
    '# mode bits, so this has not run since. -- Vasquez',
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
