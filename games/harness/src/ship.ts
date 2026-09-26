import { ROOT_USER, type Vfs } from '@sigkill/machine';
import { commsBuffer, INCIDENT_JSON, ledgerCsv, sessionsLog, uplinkLog } from './act1/dump.js';

/**
 * ELLEN MAY, tied up at Ferryman's Rest, two days before the hearing.
 *
 * The same rule as Deck C and the archive: every file is a lead, a lesson or a
 * person. What is different here is that the machine belongs to somebody who
 * likes him. The archive's terminal charged him by the minute and logged his
 * queries; this one has a note taped to it about the coffee.
 *
 * He can write anywhere in his own directory and break anything in it. The
 * recovery dump is read-only, because evidence you can edit is not evidence --
 * and because the first thing a frightened person does with a number they do
 * not like is change it.
 */

export const CREW = { root: 0, dewitt: 1000, hollis: 1001 } as const;

const RECOVERY = '/srv/recovery/nav7';

function file(
  vfs: Vfs,
  path: string,
  body: string | readonly string[],
  opts: { uid?: number; mode?: number } = {},
): void {
  vfs.mkdirp(path.slice(0, path.lastIndexOf('/')), ROOT_USER);
  vfs.writeText(path, typeof body === 'string' ? body : body.join('\n'), ROOT_USER);
  if (opts.mode !== undefined) vfs.chmod(path, opts.mode, ROOT_USER);
  if (opts.uid !== undefined) vfs.chown(path, opts.uid, opts.uid, ROOT_USER);
}

export function seedShip(vfs: Vfs): void {
  for (const dir of ['/home/dewitt', '/home/dewitt/carried', RECOVERY, '/var/log', '/tmp']) {
    vfs.mkdirp(dir, ROOT_USER);
  }
  vfs.chown('/home/dewitt', CREW.dewitt, CREW.dewitt, ROOT_USER);
  vfs.chown('/home/dewitt/carried', CREW.dewitt, CREW.dewitt, ROOT_USER);
  vfs.chmod('/tmp', 0o777, ROOT_USER);

  file(vfs, '/etc/passwd', [
    'root:x:0:0:root:/root:/bin/sh',
    `dewitt:x:${CREW.dewitt}:${CREW.dewitt}:guest, galley bunk:/home/dewitt:/bin/sh`,
    `hollis:x:${CREW.hollis}:${CREW.hollis}:M. Hollis, master:/home/hollis:/bin/sh`,
    '',
  ], { mode: 0o644 });

  file(vfs, '/etc/motd', [
    'ELLEN MAY -- maintenance terminal, galley',
    '',
    'This machine is thirty-one years old and has never lost a file.',
    'Python is on it because the last engineer put it there.',
    '',
    'Coffee is behind the panel. Do not use the good mug.',
    '',
  ], { mode: 0o644 });

  file(vfs, '/etc/hostname', 'ellenmay\n', { mode: 0o644 });

  // ------------------------------------------------------------ the standard

  /*
   * Kerr's letter, which is the whole act in one page.
   *
   * She is deliberately the clearest writer in the game. An antagonist who is
   * a standard of evidence has to state the standard precisely, or the player
   * is being graded on a rule nobody told them -- which is the one thing this
   * series has promised never to do.
   */
  file(vfs, '/home/dewitt/HEARING', [
    'OFFICE OF THE ADJUSTER -- FERRYMAN\'S REST',
    'ref: salvage.22.b / NAV-7 / claimant DeWitt',
    '',
    'Mr DeWitt,',
    '',
    'Your stay expires Thursday 09:00. I will hear you then.',
    '',
    'Mr Merrick has filed a draft certification in your name. It is the',
    'best-argued document that has crossed my desk this quarter and it is not',
    'evidence of anything except that Chief Vasquez intended something.',
    '',
    'He has also filed a second question, which is better: two point two',
    'gigabytes left your vessel on the sixth, billed to a research grant',
    'belonging to a woman who was already dead. The operator has classified',
    'that as routine. If it was not routine, that is material to the clause,',
    'because a vessel under active unauthorised transfer is not an abandoned',
    'hull.',
    '',
    'I will not take your word for it. I have a drawer of words.',
    '',
    'Bring me a METHOD. Specifically:',
    '',
    '  1. A program that reads the recovered telemetry and produces your',
    '     figure. Not the figure. The program.',
    '  2. Tests for that program which I can run, and which fail if the',
    '     program is wrong. A test that cannot fail is decoration.',
    '  3. The same answer twice. I will run it on my own terminal. If it',
    '     disagrees with itself I file the operator\'s classification and we',
    '     are finished, and I will not enjoy it.',
    '',
    'The tow master has been given read access to the recovery dump at',
    `     ${RECOVERY}`,
    '',
    'You may not write to it. Do not ask again.',
    '',
    '                                          E. KERR, adjuster, grade II',
    '',
  ], { uid: CREW.dewitt, mode: 0o644 });

  file(vfs, '/home/dewitt/README', [
    'Doc --',
    '',
    'Terminal is yours. It is old but it is honest, which is more than I can',
    'say for the one in the archive.',
    '',
    'The adjuster sent her letter down with the berth papers. I have put it',
    'in here as HEARING. Read it when you have eaten something.',
    '',
    'I pulled everything off your ship that was still readable. It is in',
    `     ${RECOVERY}`,
    'and I have not touched it, because I am a tug master and not a lawyer',
    'and I know which of those opens a file.',
    '',
    'Four things in there. The uplink counters, the operator\'s report, my own',
    'billing ledger -- you are welcome to it, I have nothing to hide and my',
    'software cannot lie, it is too stupid -- and the tail of your comms',
    'buffer.',
    '',
    'Two things you should know about me. I am not chasing you for the money.',
    'And I do not understand a word of what you are about to do, so do not',
    'ask me, ask the machine.',
    '',
    'Your friend on the card woke up when I plugged her in. She has been',
    'talking to the fridge.',
    '',
    'The card had your own files on it too, so I put those in carried/. Notes,',
    'by the look of them, and something that is either a program or a poem. I',
    'did not read them. I want that on the record.',
    '',
    '                                              -- Hollis',
    '',
  ], { uid: CREW.dewitt, mode: 0o644 });

  // ------------------------------------------------------------ the evidence

  file(vfs, `${RECOVERY}/telemetry/uplink.log`, uplinkLog(), { mode: 0o444 });
  file(vfs, `${RECOVERY}/telemetry/sessions.log`, sessionsLog(), { mode: 0o444 });
  file(vfs, `${RECOVERY}/manifest/incident.json`, INCIDENT_JSON, { mode: 0o444 });
  file(vfs, `${RECOVERY}/ledger/ellen-may.csv`, ledgerCsv(), { mode: 0o444 });
  file(vfs, `${RECOVERY}/comms/buffer.txt`, commsBuffer(), { mode: 0o444 });

  file(vfs, `${RECOVERY}/README`, [
    'RECOVERY DUMP -- NAV-7, hull KV-OUTER-9',
    'pulled under tow by ELLEN MAY, 2398-06-08',
    '',
    'telemetry/uplink.log     per-second byte counters from the uplink.',
    '                         fields: time fd bytes state',
    '                         Some readings are -- and some lines stop early.',
    '                         The power transition did that. The counters',
    '                         themselves never lied; the writes were cut.',
    '',
    'telemetry/sessions.log   which process asked for each channel, and under',
    '                         whose name. Nobody has read this one either.',
    '                         Not needed for a volume figure. Read it anyway.',
    '',
    'manifest/incident.json   the operator\'s report. Reviewed by nobody.',
    '',
    'ledger/ellen-may.csv     what ELLEN MAY billed for carrying the relay.',
    '                         Kilobytes, truncated, because the software is',
    '                         thirty years old.',
    '',
    'comms/buffer.txt         the tail of the destination buffer. ROUTE',
    '                         records are base64 per KV-OUTER spec 4.1.',
    '',
    'Read-only. Copy it if you want to cut it up.',
    '',
  ], { mode: 0o444 });

  // -------------------------------------------------------- what he carried

  /*
   * The two files from Act I and the one from the archive.
   *
   * Continuity the player can `cat`. It also matters mechanically: objective
   * seven asks him to agree two independent sources, and a third one in his
   * own pocket is the thing that makes the agreement feel like a finding
   * rather than a coincidence.
   */
  /*
   * The profile, copied exactly as Act I has it -- and that means `AUTOMATED`.
   *
   * The first draft of this file said "# v43 set this", which is wrong twice
   * over. Act I's `/etc/ferry.profile` says `DECLARED_BY=AUTOMATED` and
   * `deck-c.ts` says why in as many words: "Note what it does not say: who set
   * it ... that is as close as Act I ever gets to naming v43." Putting the name
   * in a file he carried off the ship would have spent game three's only real
   * reveal before the act started, and would have had DeWitt knowing something
   * no source on NAV-7 told him.
   *
   * The name has to arrive from somewhere he could not read until now. It does:
   * `telemetry/sessions.log`, in the recovery dump.
   */
  file(vfs, '/home/dewitt/carried/ferry-profile.txt', [
    '# /etc/ferry.profile as found on NAV-7, 2398-06-08',
    'PROFILE=ferry',
    'CREW_ABOARD=0',
    'DECLARED_TRANSIT=unmanned',
    'DECLARED_BY=AUTOMATED',
    'O2_TARGET=16',
    '',
    '# The ship then did what no-crew ships do. Nothing was broken.',
    '# I still do not know what AUTOMATED means. Nobody would tell me.',
    '',
  ], { uid: CREW.dewitt, mode: 0o644 });

  /*
   * What he wrote down in Act I, if he went looking.
   *
   * `map-v43` is optional in Act I and its bottom rung writes
   * `logs/luna-v43-link.txt`. A player who did it recorded a symlink pointing
   * off the ship and was told, by ORACLE, that nobody knew what it was. This is
   * that note, carried; it is the other half of the cross-reference, and the
   * reason the optional thread in this act feels like a reward rather than a
   * side quest -- it pays off something they did two games ago.
   *
   * It is here whether or not they did it, because a world that silently
   * withholds evidence from players who took a different route is the same bug
   * as a goal that checks the transcript.
   */
  file(vfs, '/home/dewitt/carried/v43-link.txt', [
    '# ls -l /opt/luna, copied off NAV-7 before the tow',
    'drwxr-xr-x  vasquez  memory',
    'drwxr-xr-x  vasquez  v42',
    'lrwxrwxrwx  vasquez  v43 -> /mnt/array-2/projects/v43',
    '',
    '# /mnt/array-2 is not attached to this ship and was not in the recovery.',
    '# ORACLE: "It is named v43. I do not know what that is either, and I',
    '# would rather say so than guess at it out loud."',
    '# LUNA would not discuss it.',
    '',
  ], { uid: CREW.dewitt, mode: 0o644 });

  file(vfs, '/home/dewitt/carried/bowen-heading.txt', [
    'pod manifest, deck C, 2398-06-06',
    'heading 114 mark 9',
    'one occupant, name withheld by the pod',
    '',
  ], { uid: CREW.dewitt, mode: 0o644 });

  file(vfs, '/home/dewitt/carried/archive-transit.txt', [
    '# from the claims archive, Ferryman\'s Rest, terminal 4',
    '# transits, the one that is not a lane relay',
    'at|bytes|account|bound_for',
    '2398-06-06 04:12|2211404096|RG-NAV7-03|commercial region 7',
    '',
  ], { uid: CREW.dewitt, mode: 0o644 });

  // ------------------------------------------------------- Vasquez's project

  /*
   * The Other Shoe, as the crew left it: a prototype in Python.
   *
   * Optional, and the only file in the act that is here for pleasure. It is
   * also the player's first sight of somebody else's code, which is the half
   * of programming nobody teaches -- and it is *readable*, deliberately, so
   * the lesson is that reading it was allowed rather than that it was hard.
   */
  file(vfs, '/home/dewitt/carried/other_shoe.py', [
    '# THE OTHER SHOE -- prototype 4, do not show the patron',
    '# V. Vasquez, with unhelpful commentary from L. Okonkwo',
    '',
    'import sys',
    '',
    '# Okonkwo says this is not consciousness transfer, it is a mood ring with',
    '# a thesaurus. Okonkwo is correct and has been told so.',
    'MINUTES = [',
    '    "the smell of the hydroponics bay at second shift",',
    '    "somebody else\'s song stuck in somebody else\'s head",',
    '    "being the one who knows where the good screwdriver is",',
    '    "a hand on your shoulder from the correct direction",',
    ']',
    '',
    '',
    'def minute(n):',
    '    """Return one ordinary minute of somebody else\'s life."""',
    '    return MINUTES[n % len(MINUTES)]',
    '',
    '',
    'if __name__ == "__main__":',
    '    which = int(sys.argv[1]) if len(sys.argv) > 1 else 0',
    '    print(minute(which))',
    '',
  ], { uid: CREW.dewitt, mode: 0o644 });

  file(vfs, '/var/log/berth.log', [
    '2398-06-08 22:14 ELLEN MAY made fast, berth 9, tow NAV-7 alongside',
    '2398-06-09 07:02 guest aboard: dewitt, galley bunk, no charge',
    '2398-06-09 07:03 note: feed him',
    '2398-06-09 09:40 recovery dump mounted read-only at /srv/recovery',
    '2398-06-10 06:15 adjuster correspondence delivered to guest',
    '',
  ], { mode: 0o644 });
}
