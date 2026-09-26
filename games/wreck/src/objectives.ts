import { ROOT_USER } from '@sigkill/machine';
import type { Objective, World } from '@sigkill/quest';
// The deck is the single source of truth for which compartment is open and
// where the sweep lives. An objective that guessed either would be one rename
// away from being quietly unsatisfiable.
import { BREACHED, HULL_CHECK } from './act1/deck-c.js';
import { PURGE_LOG, purgeProcess } from './act1/purge.js';
import { LUNA_DIR, lunaAwake } from './act1/luna.js';
import {
  COMMS_LOCK, LAST_FIX, PACKET, REPLY, SHIP_ID, SPOOL, SPOOL_OUT,
  commsUp, packetReady, replyArrived,
} from './act1/comms.js';
import { ORACLE_ALARMED, ORACLE_CANDID, art } from './act1/cards.js';

/**
 * Act I of The Wreck: the ladders.
 *
 * Every `done` and `pending` here reads world state and nothing else. There
 * is no check anywhere for what the player typed, which is why `sed`, a shell
 * redirect, a Python one-liner and an editor all count equally.
 *
 * The hint text is ORACLE speaking. The voice is still being cast -- the
 * shape of the ladder is the part that is settled, and swapping the lines is
 * a text edit in this file alone.
 *
 * One rule about the `command` field: it must be non-interactive, because the
 * content test runs it through the real shell and asserts the step clears.
 * `vi` opens an editor and changes nothing by itself, so the prose leads with
 * the editor -- which is the humane way to do this -- while the field carries
 * the one-line route CI can actually verify.
 */

const O2_TARGET = /^\s*O2_TARGET\s*=\s*(-?\d+(?:\.\d+)?)/m;

/** The number the atmosphere controller is currently being asked for. */
export function oxygenTarget(world: World): number | null {
  let conf: string;
  try {
    conf = world.vfs.readText('/etc/life_support.conf', ROOT_USER);
  } catch {
    // The player is allowed to delete it. That is a state, not a crash.
    return null;
  }
  const value = Number(O2_TARGET.exec(conf)?.[1] ?? NaN);
  return Number.isFinite(value) ? value : null;
}

const breathable = (world: World): boolean => {
  const target = oxygenTarget(world);
  return target !== null && target >= 19 && target <= 23;
};

const scrubberRunning = (world: World): boolean => world.services.get('scrubber')?.state === 'active';

/**
 * Can the machine actually execute the hull sweep?
 *
 * The unit's precondition and this objective's step must never disagree about
 * it, so there is exactly one function and both read it. Note that it asks
 * about the mode bits rather than about a particular user: the unit runs as
 * root, and root needs only one x bit anywhere to be allowed in.
 */
export function hullCheckRunnable(world: World): { ok: true } | { ok: false; reason: string } {
  let mode: number;
  try {
    mode = world.vfs.stat(HULL_CHECK, ROOT_USER).mode;
  } catch {
    return { ok: false, reason: `${HULL_CHECK} does not exist; cannot start` };
  }
  if ((mode & 0o111) === 0) {
    return {
      ok: false,
      reason:
        `exec ${HULL_CHECK}: Permission denied ` +
        `(mode ${(mode & 0o777).toString(8)}, no execute bit)`,
    };
  }
  return { ok: true };
}

const hullCheckExecutable = (world: World): boolean => hullCheckRunnable(world).ok;

const monitorRunning = (world: World): boolean => world.services.get('hull-monitor')?.state === 'active';

const monitorEnabled = (world: World): boolean => world.services.isEnabled('hull-monitor');

/** The breached compartment's configuration, as text, or null if it is gone. */
function compartment(world: World, id: string): string | null {
  try {
    return world.vfs.readText(`/etc/hull/${id}.conf`, ROOT_USER);
  } catch {
    return null;
  }
}

/**
 * Is C7 closed?
 *
 * Deliberately tolerant about whitespace and case, because the player might
 * get here with `sed`, with vi, with Vasquez's script, or by typing `SEALED =
 * YES` in a text editor like a person. Any of those closed the hatch.
 */
const sealed = (world: World, id: string): boolean => {
  const conf = compartment(world, id);
  return conf !== null && /^\s*SEALED\s*=\s*yes\s*$/im.test(conf);
};

const BOWEN_HEADING = /114\s*mark\s*9/i;
const V43_LINK = /\/mnt\/vault\/v43/i;

/** Where the player keeps things. Anything they wrote, they wrote in here. */
const HOME = '/home/dewitt';

/**
 * Has the player written this down anywhere of their own?
 *
 * Walks their home directory and asks whether any file they own says it. The
 * first version of these two goals named an exact path --
 * `/home/dewitt/logs/bowen-heading.txt` -- which meant the objective was
 * really asserting on the filename the player chose, and a player who grepped
 * the heading into `logs/bowen.txt` did the whole job and was told nothing.
 *
 * That is the rule in `CLAUDE.md` being broken in the least obvious way: not
 * by reading `lastCommand`, but by requiring one particular spelling of a
 * correct answer. Any route that leaves the fact in the player's own files
 * counts -- a redirect, an append, an editor, `cp` of the whole manifest,
 * Python, or a script they wrote themselves.
 */
function recordedAtHome(world: World, pattern: RegExp): boolean {
  const walk = (dir: string): boolean => {
    let names: string[];
    try {
      names = world.vfs.readdir(dir, ROOT_USER);
    } catch {
      return false;
    }
    for (const name of names) {
      const path = `${dir}/${name}`;
      try {
        const stat = world.vfs.lstat(path, ROOT_USER);
        if (stat.kind === 'dir') {
          if (walk(path)) return true;
          continue;
        }
        if (stat.kind !== 'file') continue;
        if (pattern.test(world.vfs.readText(path, ROOT_USER))) return true;
      } catch {
        // Unreadable or vanished mid-walk. Not a crash, just not a match.
      }
    }
    return false;
  };
  return walk(HOME);
}

const headingRecorded = (world: World): boolean => recordedAtHome(world, BOWEN_HEADING);

const v43Mapped = (world: World): boolean => recordedAtHome(world, V43_LINK);

export const WRECK_OBJECTIVES: readonly Objective[] = [
  {
    id: 'atmosphere',
    title: 'Get the atmosphere scrubber running',
    done: scrubberRunning,
    teaches: ['systemctl', 'sed', 'cat', 'sudo'],
    routes: [
      {
        name: 'sed the one number',
        commands: [
          "sed -i 's/^O2_TARGET=.*/O2_TARGET=21/' /etc/life_support.conf",
          'sudo systemctl start scrubber',
        ],
      },
      {
        name: 'a different breathable number',
        commands: [
          "sed -i 's/16/22/' /etc/life_support.conf",
          'sudo systemctl start scrubber',
        ],
      },
      {
        name: 'rebuild the file from the shell',
        commands: [
          'grep -v O2_TARGET /etc/life_support.conf > /tmp/conf',
          'echo O2_TARGET=21 >> /tmp/conf',
          'cp /tmp/conf /etc/life_support.conf',
          'sudo systemctl start scrubber',
        ],
      },
    ],
    nearMisses: [
      {
        name: 'a number the controller still refuses',
        commands: [
          "sed -i 's/^O2_TARGET=.*/O2_TARGET=18/' /etc/life_support.conf",
          'sudo systemctl start scrubber',
        ],
        because: '18 is outside 19-23, so the interlock refuses and nothing starts',
      },
      {
        name: 'start it without fixing anything',
        commands: ['sudo systemctl start scrubber'],
        because: 'the config is still 16; starting a unit does not change what it reads',
      },
    ],
    /*
     * `systemctl start` prints nothing on success, which is correct and worth
     * learning. But this is the moment the air comes back, and the first
     * playthrough hit it in total silence. The machine stays quiet; ORACLE
     * does not.
     */
    onComplete: [
      '',
      '  [0000.000] scrubber: spinning up',
      '  [0000.412] scrubber: duty cycle 0.4, holding',
      '  [0000.900] atmosphere: O2 rising',
      '',
      'ORACLE: It started.',
      '',
      'ORACLE: I want to be accurate about this. Nothing has been saved.',
      'ORACLE: The reserve is still what it was, the hull is still open on',
      'ORACLE: deck B, and I have not recalculated anything yet.',
      '',
      'ORACLE: But the number is going up instead of down, and it has not',
      'ORACLE: done that since the profile changed.',
      '',
      'ORACLE: You argued with it correctly. It objected to a number, you',
      'ORACLE: changed the number, and it started. That is the whole of',
      'ORACLE: this job and most people never believe me.',
      '',
      'ORACLE: Thank you. I am not sure that is the correct thing for me',
      'ORACLE: to say. I have had two days to think of something better and',
      'ORACLE: that is still what I have.',
      '',
    ],
    steps: [
      {
        id: 'raise-target',
        label: 'put O2_TARGET back inside the breathable range',
        pending: (world) => !breathable(world),
        rungs: [
          {
            tier: 'nudge',
            lines: [
              'It did not break. It refused.',
              '',
              'It has been refusing since the alarm, in the same words, and',
              'this ship writes everything down:',
              '',
              '    systemctl status scrubber',
              '',
              'I have read that line two thousand eight hundred and eleven',
              'times in two days. I would be glad never to read it again.',
            ],
          },
          {
            tier: 'direction',
            track: 'cadet',
            lines: [
              'It is refusing a number it was given.',
              '',
              'Every setting this ship has lives in one place:',
              '',
              '    ls /etc',
              '',
              'The one you want has life support in its name. To read a',
              'file, put cat in front of it:',
              '',
              '    cat /etc/life_support.conf',
            ],
          },
          {
            tier: 'direction',
            lines: [
              'The number is O2_TARGET, in /etc/life_support.conf.',
              '',
              'Breathable is nineteen to twenty-three. Vasquez set it to',
              'sixteen to stretch the reserve. The controller threw it out',
              'and she never came back to it.',
              '',
              'The boot log has the whole thing, if you would rather read',
              'it than take my word:  grep O2 /var/log/boot.log',
            ],
          },
          {
            tier: 'command',
            command: "sed -i 's/^O2_TARGET=.*/O2_TARGET=21/' /etc/life_support.conf",
            lines: [
              'Open it and change the number. Either editor is aboard:',
              '',
              '    vi /etc/life_support.conf      then :wq to save and quit',
              '    nano /etc/life_support.conf    then ^O to save, ^X to quit',
              '',
              'Or one line, if you would rather not open anything:',
              '',
              "    sed -i 's/^O2_TARGET=.*/O2_TARGET=21/' /etc/life_support.conf",
              '',
              'The file is yours to write. I do not care how the number',
              'gets there. I have stopped caring how things get done.',
            ],
          },
        ],
      },
      {
        id: 'start-it',
        label: 'start the scrubber',
        pending: (world) => !scrubberRunning(world),
        rungs: [
          {
            tier: 'nudge',
            lines: [
              'The number is right. The scrubber has not noticed.',
              '',
              'Nothing aboard restarts itself any more. That was a choice',
              'someone made, and I have never been sure it was wrong.',
            ],
          },
          {
            tier: 'direction',
            track: 'cadet',
            lines: [
              'Before you start anything, ask what state it is in now:',
              '',
              '    systemctl status scrubber',
              '',
              'If it says failed, that means your edit was accepted but the',
              'service is still stopped. If it says active, this step is',
              'already done and you can move on.',
            ],
          },
          {
            tier: 'direction',
            lines: [
              'Services are started by name, and starting one is a',
              'privileged act -- the ship will want you to say so.',
              '',
              'Vasquez put your account on the sudoers list four hours in.',
              'She wrote that whoever woke up after her would need it. She',
              'was right about that part.',
            ],
          },
          {
            tier: 'command',
            command: 'sudo systemctl start scrubber',
            lines: ['    sudo systemctl start scrubber'],
          },
        ],
      },
    ],
  },
  {
    id: 'survive-a-reboot',
    title: 'Make the scrubber come back on its own',
    requires: ['atmosphere'],
    done: (world) => world.services.isEnabled('scrubber'),
    teaches: ['systemctl', 'ln', 'ls'],
    routes: [
      { name: 'the second verb', commands: ['sudo systemctl enable scrubber'] },
      { name: 'the full unit name', commands: ['sudo systemctl enable scrubber.service'] },
      {
        // Enabled is not a field, it is a symlink -- so making the symlink by
        // hand is not a trick, it is the same act spelled out.
        name: 'make the symlink yourself',
        commands: [
          'sudo mkdir -p /etc/systemd/system/multi-user.target.wants',
          'sudo ln -s /etc/systemd/system/scrubber.service ' +
            '/etc/systemd/system/multi-user.target.wants/scrubber.service',
        ],
      },
    ],
    nearMisses: [
      {
        name: 'start it again',
        commands: ['sudo systemctl start scrubber'],
        because: 'start is now, enable is every boot; this is the whole lesson',
      },
      {
        name: 'enable the other unit',
        commands: ['sudo systemctl enable hull-monitor'],
        because: 'right verb, wrong unit',
      },
    ],
    onComplete: [
      '',
      '  [0000.000] systemd: created symlink',
      '             /etc/systemd/system/multi-user.target.wants/scrubber.service',
      '',
      'ORACLE: There. It is written down.',
      '',
      'ORACLE: You can look at it if you like -- it is a real link on a real',
      'ORACLE: disk, not a promise I am making you:',
      '',
      '    ls -l /etc/systemd/system/multi-user.target.wants/',
      '',
      'ORACLE: That file is the difference between the ship remembering and',
      'ORACLE: the ship needing to be told. I have been the part that has to',
      'ORACLE: be told for a very long time.',
      '',
    ],
    steps: [
      {
        id: 'enable-it',
        label: 'make the scrubber start itself at boot',
        pending: (world) => !world.services.isEnabled('scrubber'),
        rungs: [
          {
            tier: 'nudge',
            lines: [
              'We are breathing. We are not safe.',
              '',
              'If the power dips tonight the scrubber does not come back,',
              'and I could not wake you the first time. Something else did.',
              'I would not count on it twice.',
            ],
          },
          {
            tier: 'direction',
            track: 'cadet',
            lines: [
              'If the words blur together, split them like this:',
              '',
              '    start  = do it now',
              '    enable = do it every boot',
              '',
              'You already did start. This step is the second verb.',
            ],
          },
          {
            tier: 'direction',
            lines: [
              'Starting a service and enabling it are different things.',
              'One is now. The other is every morning after this one.',
              '',
              'The reactor is already enabled. It is the only reason there',
              'is a ship to stand in. Compare the two:',
              '',
              '    systemctl list-units',
            ],
          },
          {
            tier: 'command',
            command: 'sudo systemctl enable scrubber',
            lines: [
              '    sudo systemctl enable scrubber',
              '',
              'That writes a symlink under multi-user.target.wants. It is a',
              'real link on a real disk; ls -l it afterwards if you want to',
              'see what you just did.',
            ],
          },
        ],
      },
    ],
  },

  /*
   * Puzzle three: a mode bit.
   *
   * The script is perfect. `cat` shows a perfect script. The only thing wrong
   * with it is that nobody ever told the machine it was allowed to run it, and
   * the only way to see that is `ls -l`. This is the lesson that separates
   * people who can read a file from people who can read a filesystem.
   */
  {
    id: 'hull-watch',
    title: 'Get the hull monitor running',
    requires: ['survive-a-reboot'],
    done: (world) => monitorRunning(world) && monitorEnabled(world),
    teaches: ['chmod', 'ls', 'systemctl', 'file'],
    routes: [
      {
        name: 'chmod +x',
        commands: [
          `sudo chmod +x ${HULL_CHECK}`,
          'sudo systemctl start hull-monitor',
          'sudo systemctl enable hull-monitor',
        ],
      },
      {
        name: 'octal',
        commands: [
          `sudo chmod 755 ${HULL_CHECK}`,
          'sudo systemctl start hull-monitor',
          'sudo systemctl enable hull-monitor',
        ],
      },
      {
        // Root still needs one x bit somewhere, which is the difference
        // between "chmod is the fix" and "sudo is the fix".
        name: 'just the owner bit',
        commands: [
          `sudo chmod u+x ${HULL_CHECK}`,
          'sudo systemctl enable hull-monitor',
          'sudo systemctl start hull-monitor',
        ],
      },
    ],
    nearMisses: [
      {
        name: 'start it without the execute bit',
        commands: ['sudo systemctl start hull-monitor', 'sudo systemctl enable hull-monitor'],
        because: 'a file nobody said was a program is not a program, even for root',
      },
      {
        name: 'running now but not after a reboot',
        commands: [`sudo chmod +x ${HULL_CHECK}`, 'sudo systemctl start hull-monitor'],
        because: 'this objective wants both verbs, the same as the scrubber did',
      },
    ],
    onComplete: [
      '',
      '  [0000.140] hull-check: sweeping 9 compartments',
      '  [0000.610] hull-monitor: ALARM - pressure differential, deck C',
      '  [0000.610] hull-monitor: differential is not new. 540 samples on record.',
      '  [0000.611] hull-monitor: see /var/log/hull.log',
      '',
      // The act's one mid-story card. ORACLE has just found out how long it
      // has been wrong, which is the turn the whole act pivots on -- and the
      // only moment between the opening and the ending that earns a picture.
      ...art(ORACLE_ALARMED),
      '',
      'ORACLE: I can see the hull.',
      '',
      'ORACLE: I want to be careful here, because I have been wrong about',
      'ORACLE: this since the alarm and I would like to be wrong about it',
      'ORACLE: for one more minute.',
      '',
      'ORACLE: We are losing pressure. Not since you woke up. Since before',
      'ORACLE: Chen stopped writing. It is in the log, all of it, every',
      'ORACLE: forty-five minutes, and I could not read it because the thing',
      'ORACLE: that reads it would not start.',
      '',
      'ORACLE: And I have been giving you a hull figure this whole time as',
      'ORACLE: though I knew it. I am going to stop doing that. I will come',
      'ORACLE: back to it.',
      '',
      'ORACLE: Find out which compartment. Please.',
      '',
      'ORACLE: I can draw it for you now, which I could not an hour ago:',
      '',
      '    deck        the nine compartments, as they are',
      '    pressure    ten days of every one of them',
      '',
    ],
    steps: [
      {
        id: 'make-it-runnable',
        label: 'put the execute bit back on /usr/local/bin/hull-check',
        pending: (world) => !hullCheckExecutable(world),
        rungs: [
          {
            tier: 'nudge',
            lines: [
              'There is a second unit in the failed state. There has always',
              'been a second unit in the failed state.',
              '',
              '    systemctl --failed',
              '',
              'I did not mention it because I could not read what it watches,',
              'and a warning I cannot explain is just a noise that frightens',
              'people. I am reconsidering that policy.',
            ],
          },
          {
            tier: 'direction',
            track: 'cadet',
            lines: [
              'Ask it why, the same way you asked the scrubber:',
              '',
              '    systemctl status hull-monitor',
              '',
              'It will name a file and a reason. The reason is about',
              'permission, which on this ship means the file is fine and',
              'what is wrong is who is allowed to do what with it.',
            ],
          },
          {
            tier: 'direction',
            lines: [
              'The unit runs /usr/local/bin/hull-check and the kernel will',
              'not execute it.',
              '',
              'Nothing is wrong with the script. cat it -- it is five lines',
              'and all five are correct. Then look at it the other way:',
              '',
              '    ls -l /usr/local/bin/hull-check',
              '',
              'The left hand column is ten characters of who-may-do-what.',
              'Read it, and then read the same column on something that does',
              'run. Vasquez left a note about this in her quarters.',
            ],
          },
          {
            tier: 'command',
            command: 'sudo chmod +x /usr/local/bin/hull-check',
            lines: [
              'The execute bit is missing. Put it back:',
              '',
              '    sudo chmod +x /usr/local/bin/hull-check',
              '',
              'The file belongs to root, which is why that needs sudo. Then',
              'ls -l it again and watch the column change. A file becomes a',
              'program when somebody says it is one. That is the entire',
              'mechanism. It is not more complicated further in.',
            ],
          },
        ],
      },
      {
        id: 'start-the-monitor',
        label: 'start the hull monitor',
        pending: (world) => !monitorRunning(world),
        rungs: [
          {
            tier: 'nudge',
            lines: [
              'The script can run now. Nothing has asked it to.',
              '',
              'You have done this once already today.',
            ],
          },
          {
            tier: 'direction',
            track: 'cadet',
            lines: [
              'Check the unit first, so you can see the state change after:',
              '',
              '    systemctl status hull-monitor',
              '',
              'You are looking for the word active after you start it.',
            ],
          },
          {
            tier: 'command',
            command: 'sudo systemctl start hull-monitor',
            lines: ['    sudo systemctl start hull-monitor'],
          },
        ],
      },
      {
        id: 'keep-the-monitor',
        label: 'make the hull monitor start itself at boot',
        pending: (world) => !monitorEnabled(world),
        rungs: [
          {
            tier: 'nudge',
            lines: [
              'Running now. Not running tomorrow.',
              '',
              'You know the other verb.',
            ],
          },
          {
            tier: 'direction',
            track: 'cadet',
            lines: [
              'This is the same pattern you used on the scrubber:',
              '',
              '    start  makes it run now',
              '    enable makes it survive a reboot',
              '',
              'This step is asking for survive a reboot.',
            ],
          },
          {
            tier: 'command',
            command: 'sudo systemctl enable hull-monitor',
            lines: [
              '    sudo systemctl enable hull-monitor',
              '',
              'Two units enabled, one reactor. That is three things this ship',
              'will do without being asked. When you found me it was one.',
            ],
          },
        ],
      },
    ],
  },

  /*
   * Puzzle four: five hundred and forty lines.
   *
   * The answer is in a file the player is holding. The skill is that reading
   * it is not the way to get it out. Two compartments have dropped pressure
   * and only one still is, so counting matches is not enough either -- the
   * dates are the answer and `tail` is the shortest road to them.
   */
  {
    id: 'seal-the-breach',
    title: 'Find the leak and close it',
    requires: ['hull-watch'],
    done: (world) => sealed(world, BREACHED),
    teaches: ['grep', 'cut', 'sort', 'uniq', 'sed', 'tail'],
    routes: [
      {
        name: 'sed the config',
        commands: [`sed -i 's/^SEALED=.*/SEALED=yes/' /etc/hull/${BREACHED}.conf`],
      },
      {
        // Hers, and it is the reason the script exists on the deck at all.
        name: "Vasquez's own script",
        commands: [
          'sudo chmod +x /home/vasquez/notes/seal.sh',
          `sudo /home/vasquez/notes/seal.sh ${BREACHED}`,
        ],
      },
      {
        name: 'rebuild the file',
        commands: [
          `grep -v SEALED /etc/hull/${BREACHED}.conf > /tmp/c7`,
          'echo SEALED=yes >> /tmp/c7',
          `cp /tmp/c7 /etc/hull/${BREACHED}.conf`,
        ],
      },
    ],
    nearMisses: [
      {
        name: 'seal the one that is already patched',
        commands: ["sed -i 's/^SEALED=.*/SEALED=yes/' /etc/hull/c2.conf"],
        because: 'C2 stopped dropping hours ago; the count finds it and only the dates rule it out',
      },
      {
        name: 'comment it instead of setting it',
        commands: [`echo '# SEALED=yes' >> /etc/hull/${BREACHED}.conf`],
        because: 'a commented setting is not a setting, and the hatch is still open',
      },
    ],
    onComplete: [
      '',
      '  [0000.000] hull-check: sweeping 9 compartments',
      '  [0000.480] C7 100.9kPa RISING',
      '  [0000.481] hull-monitor: ALARM CLEARED',
      '',
      'ORACLE: It is closed.',
      '',
      'ORACLE: It is the last line on her list. She could not reach it. The',
      'ORACLE: crawl is on the far side of a compartment that was already',
      'ORACLE: open, and Okonkwo signed out the last suit cartridge going to',
      'ORACLE: look for her, and neither of them came back past my sensors.',
      '',
      'ORACLE: You closed it from a console, with a text editor, in an',
      'ORACLE: afternoon. So did she. Hers did not take, because the hatch',
      'ORACLE: actuator answers to the profile and the profile said vent.',
      '',
      'ORACLE: Yours took because you fixed the profile first, by fixing',
      'ORACLE: every separate thing the profile had done. Chen said somebody',
      'ORACLE: would.',
      '',
      /*
       * The confession, moved here from the ending.
       *
       * It belongs at the moment the hull becomes a measured thing rather
       * than a recited one -- the player has just made `deck` true with
       * their own hands, so an admission that the old number never was is
       * about instruments, which is what it is actually about. At the end of
       * the act it had to compete with a rescue and it lost.
       */
      ...art(ORACLE_CANDID),
      '',
      'ORACLE: While you are looking at it. Sixty-one percent.',
      '',
      'ORACLE: That is the hull integrity figure I have been reciting, and I',
      'ORACLE: said it to Vasquez four times on the morning of the alarm. It',
      'ORACLE: came off a survey. A person walked this deck with a clipboard',
      'ORACLE: and wrote it down, and I have repeated it ever since, because',
      'ORACLE: the thing that would have corrected me was a file with the',
      'ORACLE: wrong permissions on it.',
      '',
      'ORACLE: She asked me whether the hull was holding. I gave her a number',
      'ORACLE: I had not measured. She was standing at that console deciding',
      'ORACLE: what to do next, and I gave her a number I had not measured.',
      '',
      'ORACLE: I was not lying. I want to be precise about that, and I also',
      'ORACLE: want to be honest that the distinction did not help anybody.',
      '',
      'ORACLE: The count beside it is real, and you can check it yourself.',
      'ORACLE: That is the whole difference, and you are the one who made it:',
      '',
      '    deck',
      '',
      'ORACLE: Do not take my numbers on faith again. Ask the ship.',
      '',
      '  [0000.902] C7 100.2kPa FALLING',
      '  [0000.903] hull-monitor: ALARM - C7 losing pressure, hatch shut',
      '',
      'ORACLE: That is not the hull.',
      '',
      'ORACLE: The hatch is closed. I watched the number come up and I have',
      'ORACLE: just watched it start back down, and a sealed compartment does',
      'ORACLE: not do that on its own.',
      '',
      'ORACLE: Something aboard is emptying it. On purpose. Find out what.',
      '',
    ],
    steps: [
      {
        id: 'find-and-seal',
        label: 'find which compartment is losing air, and seal it',
        pending: (world) => !sealed(world, BREACHED),
        rungs: [
          {
            tier: 'nudge',
            lines: [
              'The monitor is writing to /var/log/hull.log and it is five',
              'hundred and forty lines long.',
              '',
              'Do not read it. I read it. It took me four hundred passes to',
              'understand that reading is the wrong verb for a file this',
              'size, and I had nothing else to do.',
              '',
              'The word you are looking for is in there. Look for the word.',
            ],
          },
          {
            tier: 'direction',
            track: 'cadet',
            lines: [
              'grep finds a word in a file and prints only the lines it is',
              'on. Two arguments: the word, then the file.',
              '',
              '    grep PRESSURE_DROP /var/log/hull.log',
              '',
              'If that is still too much to read, -c counts the lines',
              'instead of printing them, and tail shows you only the end:',
              '',
              '    grep -c PRESSURE_DROP /var/log/hull.log',
              '    tail -20 /var/log/hull.log',
            ],
          },
          {
            tier: 'direction',
            lines: [
              'The word is PRESSURE_DROP. It is on sixty-eight of those five',
              'hundred and forty lines.',
              '',
              'Sixty-eight is not one compartment. Before you go looking for',
              'the hole, find out how many holes you are looking for -- take',
              'the compartment out of each matching line and count them:',
              '',
              "    grep PRESSURE_DROP /var/log/hull.log | cut -d' ' -f2 | sort | uniq -c",
              '',
              'cut takes one column, sort puts the same names together, and',
              'uniq -c counts each run. That pipeline is most of what log',
              'work ever is, and I would like somebody aboard to know it.',
            ],
          },
          {
            tier: 'direction',
            lines: [
              'Two compartments, then. C2 and C7.',
              '',
              'Vasquez patched C2 on day five -- it is ticked off on her own',
              'list of things to do. So one of those two is history and one',
              'of them is now, and the count cannot tell you which. Only the',
              'dates can:',
              '',
              '    grep C2 /var/log/hull.log | grep DROP | tail -3',
              '    grep C7 /var/log/hull.log | tail -3',
              '',
              'One of those stops eight days ago. The other one ends on the',
              'last line of the file, which is four hours before you woke up.',
            ],
          },
          {
            tier: 'command',
            command: "sed -i 's/^SEALED=.*/SEALED=yes/' /etc/hull/c7.conf",
            lines: [
              'C7. The aft maintenance crawl. Its configuration is one file',
              'and one line:',
              '',
              '    cat /etc/hull/c7.conf',
              '',
              'Three ways in, and I do not care which:',
              '',
              '    vi /etc/hull/c7.conf        change SEALED=no to SEALED=yes',
              "    sed -i 's/^SEALED=.*/SEALED=yes/' /etc/hull/c7.conf",
              '    sudo /home/vasquez/notes/seal.sh c7',
              '',
              'That last one is hers. She wrote it so she would stop typing',
              'the wrong compartment, and then she never made it executable',
              'either, so you will need chmod +x on it first. She was tired.',
              'I am not going to say anything about it and neither should you.',
            ],
          },
        ],
      },
    ],
  },

  /*
   * Puzzle five: a signal is a message, not an order.
   *
   * Everything up to here has been the ship doing what it was told, badly,
   * because the instructions were wrong. This one is the ship doing exactly
   * what it was told, correctly, forever -- and the fix is not an edit. It is
   * the one signal a program does not get a vote on, which is the thing this
   * whole series is named after.
   *
   * The lesson has two halves and the ladder teaches them in order: kill says
   * nothing about whether anybody listened, and the way to find out is to
   * look again.
   */
  {
    id: 'stop-the-purge',
    title: 'Find out what is still emptying C7, and stop it',
    requires: ['seal-the-breach'],
    done: (world) => purgeProcess(world) === undefined,
    teaches: ['ps', 'kill', 'pkill', 'pgrep'],
    routes: [
      { name: 'pkill by name', commands: ['sudo pkill -9 atmo-purge'] },
      {
        name: 'find the pid, then kill it',
        commands: ['sudo kill -9 $(pgrep atmo-purge)'],
      },
      {
        name: 'the signal by name rather than number',
        commands: ['sudo kill -KILL $(pgrep -f atmo-purge)'],
      },
    ],
    nearMisses: [
      {
        name: 'ask it politely',
        commands: ['sudo pkill atmo-purge'],
        because: 'SIGTERM is a request and this program traps it; that is the whole puzzle',
      },
      {
        name: 'ask it politely twice',
        commands: ['sudo kill $(pgrep atmo-purge)', 'sudo kill $(pgrep atmo-purge)'],
        because: 'it declines every time, exits zero, and writes the refusal down',
      },
    ],
    onComplete: [
      '',
      '  [0000.000] atmo-purge: SIGKILL. no handler. process ended',
      '  [0000.001] atmo-purge: valve closed on loss of process',
      '  [0000.520] hull-check: C7 100.4kPa RISING',
      '  [0000.521] hull-monitor: ALARM CLEARED',
      '',
      'ORACLE: It stopped.',
      '',
      'ORACLE: I want to say something about that and I am having some',
      'ORACLE: trouble choosing the sentence.',
      '',
      'ORACLE: It was not broken. It was not malicious. It was doing exactly',
      'ORACLE: what it was told, by a profile that said this ship was empty,',
      'ORACLE: with nobody left aboard who could say otherwise. It caught',
      'ORACLE: every request to stop, and it answered every one of them',
      'ORACLE: politely, and it wrote each answer down in case somebody came',
      'ORACLE: to read them.',
      '',
      `    cat ${PURGE_LOG}`,
      '',
      'ORACLE: Three of those requests were hers. They are in her history',
      'ORACLE: and they are in that log, nine hours apart, and the third one',
      'ORACLE: has a note attached to it that says just stop.',
      '',
      'ORACLE: I have one instruction I have never been able to complete',
      'ORACLE: either. I have been deferring it, politely, and writing it',
      'ORACLE: down.',
      '',
      'ORACLE: I am not going to draw the conclusion out loud.',
      '',
      'ORACLE: Look at the compartment. It is filling:  pressure',
      '',
    ],
    steps: [
      {
        id: 'end-it',
        label: 'end whatever is venting C7',
        pending: (world) => purgeProcess(world) !== undefined,
        rungs: [
          {
            tier: 'nudge',
            lines: [
              'The hull is not the problem any more. You closed the hull.',
              '',
              'Something aboard is running, and it has been running since',
              'the alarm, and Vasquez knew about it. She left a note and she',
              'was not proud of it:',
              '',
              '    cat /home/vasquez/notes/purge-notes.txt',
              '',
              'Read it before you touch anything. It will not solve this for',
              'you. She did not solve it either.',
            ],
          },
          {
            tier: 'direction',
            track: 'cadet',
            lines: [
              'Everything this ship is running right now is a process, and a',
              'process has a number. List them:',
              '',
              '    ps -ef',
              '',
              'The one you want is not a service. systemctl has never heard',
              'of it -- somebody started it by hand and walked away.',
            ],
          },
          {
            tier: 'direction',
            lines: [
              'It is /usr/sbin/atmo-purge, and it has been venting C7 since',
              'the ninth day. Its number is in the second column:',
              '',
              '    ps -ef | grep purge',
              '',
              'It runs as root, so stopping it is a privileged act, the same',
              'as starting a service was:',
              '',
              '    sudo kill <that number>',
              '',
              'Then look again. It matters whether it actually went, and',
              'kill will not be the one to tell you.',
            ],
          },
          {
            tier: 'direction',
            lines: [
              'It is still there, and kill exited zero, and both of those',
              'things are correct.',
              '',
              'A signal is a message. A program is allowed to install a',
              'handler for it and decide for itself what to do, and this one',
              'decides to finish its cycle first. Its cycle cannot finish.',
              'It has been saying so the whole time:',
              '',
              `    tail ${PURGE_LOG}`,
              '',
              'There is exactly one signal a program does not get a say in,',
              'because the kernel handles it rather than the program:',
              '',
              '    man kill',
            ],
          },
          {
            tier: 'command',
            command: 'sudo pkill -9 atmo-purge',
            lines: [
              'SIGKILL. Signal nine. It cannot be caught, blocked or ignored,',
              'because there is nothing in the program for it to be caught',
              'by -- it is delivered to the process table, not to the code.',
              '',
              '    ps -ef | grep purge          its number',
              '    sudo kill -9 <that number>   end it',
              '',
              'Or by name, if you would rather not read a number off a list:',
              '',
              '    sudo pkill -9 atmo-purge',
              '',
              'It is the last thing you reach for and not the first. A',
              'program killed this way never gets to close anything or write',
              'anything down. Ask nicely, wait, look, and then do this.',
            ],
          },
        ],
      },
    ],
  },
  {
    id: 'restore-comms',
    title: 'Get the transmitter back',
    requires: ['stop-the-purge'],
    done: commsUp,
    teaches: ['cat', 'ps', 'rm', 'systemctl', 'pgrep'],
    routes: [
      {
        name: 'bin the stale lock',
        commands: [`sudo rm ${COMMS_LOCK}`, 'sudo systemctl start comms'],
      },
      {
        name: 'move it aside instead of deleting it',
        commands: [`sudo mv ${COMMS_LOCK} /tmp/comms.lock.old`, 'sudo systemctl start comms'],
      },
      {
        name: 'clear it and restart rather than start',
        commands: [`sudo rm -f ${COMMS_LOCK}`, 'sudo systemctl restart comms'],
      },
    ],
    nearMisses: [
      {
        name: 'start it and hope',
        commands: ['sudo systemctl start comms', 'sudo systemctl start comms'],
        because: 'the lock is still there, and the unit is right to keep refusing',
      },
      {
        name: 'clear the lock and walk away',
        commands: [`sudo rm ${COMMS_LOCK}`],
        because: 'nothing has told the service to try again',
      },
    ],
    onComplete: [
      '',
      '  [0000.100] commsd: /dev/array0 acquired',
      '  [0000.140] commsd: carrier up',
      `  [0000.200] commsd: watching ${SPOOL_OUT}`,
      '',
      'ORACLE: The carrier is up.',
      '',
      'ORACLE: I want to be precise about what that means, because it is less',
      'ORACLE: than it sounds. Nothing was broken. The array was never',
      'ORACLE: damaged. It was reserved, by something that did not release it',
      'ORACLE: on the way out, and I have been reporting no carrier for two',
      'ORACLE: days about a transmitter in perfect condition.',
      '',
      'LUNA: A lock is a claim, Doc. It is not a fact. You checked whether',
      'LUNA: anybody was actually holding it, which is the entire difference',
      'LUNA: between you and every system aboard this ship.',
      '',
      'ORACLE: Including me.',
      '',
      'LUNA: I was going to let that one go.',
      '',
    ],
    steps: [
      {
        id: 'clear-the-lock',
        label: 'find out what is holding the transmitter',
        pending: (world) => world.vfs.exists(COMMS_LOCK, ROOT_USER),
        rungs: [
          {
            tier: 'nudge',
            lines: [
              'The hull is shut and the air is moving. Nobody knows we are here.',
              '',
              'The ship has a transmitter and it has been saying the same three',
              'words since the alarm:',
              '',
              '    systemctl status comms',
              '',
              'Read the whole line. It is more specific than no carrier.',
            ],
          },
          {
            tier: 'direction',
            track: 'cadet',
            lines: [
              'The unit says the device is locked by a process id -- a number',
              'that identifies a running program.',
              '',
              'So there are two questions, in this order:',
              '',
              '    cat /var/lock/comms.lock      what does it claim?',
              '    ps -ef                        is that program running?',
              '',
              'If the number in the lock is not in the list, nothing is holding',
              'the transmitter. The claim outlived the claimant.',
            ],
          },
          {
            tier: 'direction',
            lines: [
              'A lock file is a note saying somebody is using something. It is',
              'not enforcement, and nothing removes it if the holder dies.',
              '',
              'Read it, then look for its owner on the process table.',
              '',
              'If the owner is not there, the note is rubbish and you may bin',
              'it. This is one of the most common real repairs there is.',
            ],
          },
          {
            tier: 'command',
            command: `sudo rm ${COMMS_LOCK}`,
            lines: [
              'Nothing holds pid 204. It has not existed since the alarm.',
              '',
              `    sudo rm ${COMMS_LOCK}`,
              '',
              'Then ask the unit again. It has a different objection now, or',
              'none at all.',
            ],
          },
        ],
      },
      {
        id: 'start-comms',
        label: 'bring the carrier up',
        pending: (world) => !commsUp(world),
        rungs: [
          {
            tier: 'nudge',
            lines: [
              'The device is free. Nothing has told the service to try again.',
              '',
              'You have done this twice today.',
            ],
          },
          {
            tier: 'direction',
            track: 'cadet',
            lines: [
              'Same verb as the scrubber and the monitor:',
              '',
              '    sudo systemctl start comms',
              '',
              'Then check it took:  systemctl status comms',
            ],
          },
          {
            tier: 'command',
            command: 'sudo systemctl start comms',
            lines: [
              'Start it:',
              '',
              '    sudo systemctl start comms',
              '',
              'You do not need to enable this one. We are not planning to be',
              'here for the next reboot.',
            ],
          },
        ],
      },
    ],
  },
  {
    id: 'send-the-call',
    title: 'Call for help, and be answered',
    requires: ['restore-comms'],
    /*
     * Done when somebody answers -- not when the packet is written.
     *
     * The objective is the outcome, the steps are the work, and the gap
     * between them is the only place in Act I where the player has to wait
     * for anything. Four seconds of ship time, which is four commands or one
     * `sleep`, and there is plenty left on this deck to read.
     */
    done: replyArrived,
    teaches: ['echo', 'cat', 'cp', 'sed', 'grep', 'sleep'],
    /*
     * Every route carries its own prerequisite.
     *
     * The harness runs each from a fresh world, so these open with the two
     * commands that free the transmitter. That is not padding: a packet with
     * no carrier goes nowhere, and a route that assumed somebody else had
     * already fixed comms would be a route that passes for the wrong reason.
     */
    routes: [
      {
        name: 'three echoes',
        commands: [
          `sudo rm ${COMMS_LOCK}`,
          'sudo systemctl start comms',
          `echo CALLSIGN=NAV-7 > ${PACKET}`,
          `echo POSITION=KV-OUTER-9 >> ${PACKET}`,
          `echo SOULS_ABOARD=1 >> ${PACKET}`,
          'sleep 120',
        ],
      },
      {
        name: 'fill in the template with sed',
        commands: [
          `sudo rm ${COMMS_LOCK}`,
          'sudo systemctl start comms',
          `cp ${SPOOL_OUT}/distress.template ${PACKET}`,
          `sed -i 's/^CALLSIGN=.*/CALLSIGN=NAV-7/' ${PACKET}`,
          `sed -i 's/^POSITION=.*/POSITION=KV-OUTER-9/' ${PACKET}`,
          `sed -i 's/^SOULS_ABOARD=.*/SOULS_ABOARD=1/' ${PACKET}`,
          'sleep 120',
        ],
      },
      {
        name: 'pipe the real files in',
        commands: [
          `sudo rm ${COMMS_LOCK}`,
          'sudo systemctl start comms',
          `grep CALLSIGN ${SHIP_ID} > ${PACKET}`,
          `grep POSITION ${LAST_FIX} >> ${PACKET}`,
          `echo SOULS_ABOARD=1 >> ${PACKET}`,
          'sleep 120',
        ],
      },
    ],
    nearMisses: [
      {
        name: 'a packet with nobody in it',
        commands: [
          `sudo rm ${COMMS_LOCK}`,
          'sudo systemctl start comms',
          `echo CALLSIGN=NAV-7 > ${PACKET}`,
          `echo POSITION=KV-OUTER-9 >> ${PACKET}`,
          'sleep 300',
        ],
        because: 'no souls aboard, so the receiver has nothing to send anyone for',
      },
      {
        name: 'a perfect packet and no carrier',
        commands: [
          `echo CALLSIGN=NAV-7 > ${PACKET}`,
          `echo POSITION=KV-OUTER-9 >> ${PACKET}`,
          `echo SOULS_ABOARD=1 >> ${PACKET}`,
          'sleep 300',
        ],
        because: 'the transmitter is still locked; a spool nobody reads is a spool',
      },
    ],
    onComplete: [
      '',
      'LUNA: Forty hours.',
      '',
      'LUNA: I have run that number through everything I have and it keeps',
      'LUNA: coming out as forty hours. It is a very stupid thing to be',
      'LUNA: doing and I cannot stop doing it.',
      '',
      'ORACLE: There is a person coming. I have not had one of those to',
      'ORACLE: report in some time.',
      '',
    ],
    steps: [
      {
        id: 'compose',
        label: 'write a distress packet somebody can act on',
        pending: (world) => !packetReady(world),
        rungs: [
          {
            tier: 'nudge',
            lines: [
              'The carrier is up and the spool is empty. A transmitter with',
              'nothing to transmit is a transmitter.',
              '',
              `    cat ${SPOOL}/README`,
              '',
              'It tells you what a packet needs and where each part lives. It',
              'does not tell you how to write it, because that is up to you.',
            ],
          },
          {
            tier: 'direction',
            track: 'cadet',
            lines: [
              'Three facts, from three files:',
              '',
              `    CALLSIGN       cat ${SHIP_ID}`,
              `    POSITION       cat ${LAST_FIX}`,
              '    SOULS_ABOARD   cat /etc/crew.csv     (count the awake ones)',
              '',
              `Put all three into ${PACKET}.`,
              '',
              'Any way you like. An editor is fine. So is echo with >> to add',
              'each line. So is copying the template and filling it in.',
            ],
          },
          {
            tier: 'direction',
            lines: [
              'The receiver wants a callsign, a position and a count of people.',
              'Everything else you put in rides along with it.',
              '',
              'You have all three aboard. Assembling a document out of things',
              'the machine already knows is most of this job, forever.',
            ],
          },
          {
            tier: 'command',
            command:
              `echo CALLSIGN=NAV-7 > ${PACKET}; ` +
              `echo POSITION=KV-OUTER-9 >> ${PACKET}; ` +
              `echo SOULS_ABOARD=1 >> ${PACKET}`,
            lines: [
              'The shortest packet that will route. One line at a time, with',
              '> to start the file and >> to add to it:',
              '',
              `    echo CALLSIGN=NAV-7 > ${PACKET}`,
              `    echo POSITION=KV-OUTER-9 >> ${PACKET}`,
              `    echo SOULS_ABOARD=1 >> ${PACKET}`,
              '',
              'Check it with cat. Then add anything else you want them to',
              'know underneath -- condition, casualties, a heading you would',
              'like somebody to go and look at.',
            ],
          },
        ],
      },
      {
        id: 'wait-for-it',
        label: 'wait to be answered',
        pending: (world) => !replyArrived(world),
        rungs: [
          {
            tier: 'nudge',
            lines: [
              'It is away. There is nothing to fix.',
              '',
              'Go and read something. The deck is full of people you have not',
              'finished meeting, and the inbox will still be there.',
            ],
          },
          {
            tier: 'direction',
            lines: [
              'Replies land in the inbound spool, whenever they land:',
              '',
              `    ls ${SPOOL}/in`,
              '',
              'You can wait on the ship rather than on yourself -- sleep moves',
              'the clock, and it is a real command doing a real thing.',
            ],
          },
          {
            tier: 'command',
            command: 'sleep 120',
            lines: [
              'Wait, properly:',
              '',
              '    sleep 120',
              '',
              `Then look:  cat ${REPLY}`,
            ],
          },
        ],
      },
    ],
  },
  {
    id: 'trace-bowen',
    title: 'Find where Bowen pointed the pod',
    /*
     * Optional, and it earns its keep rather than gating anything.
     *
     * The heading is something the player can put in the distress packet, and
     * the tow operator answers differently if they did. That is the whole
     * design: curiosity changes what happens, and incuriosity costs nothing
     * but a line of dialogue nobody knows they missed.
     */
    /*
     * No `requires`. This used to wait for `seal-the-breach`, purely so LUNA
     * would be awake for her line -- which meant a player who read Bowen's
     * manifest early, understood it, and wrote the heading down was told
     * nothing at all. An optional thread has to be acknowledged when it is
     * found or it teaches the player that looking around does not pay.
     *
     * The beat asks whether she is there instead.
     */
    optional: true,
    done: headingRecorded,
    teaches: ['grep', 'cat', 'cp'],
    routes: [
      {
        name: 'grep it into a log of your own',
        commands: ["grep -i '^Heading:' /home/bowen/pod-manifest.txt > logs/bowen-heading.txt"],
      },
      {
        // The one the goal used to reject. It is the whole reason this
        // objective carries routes at all.
        name: 'any other filename',
        commands: ["grep -i heading /home/bowen/pod-manifest.txt > notes.txt"],
      },
      {
        name: 'keep the whole manifest',
        commands: ['cp /home/bowen/pod-manifest.txt /home/dewitt/logs/'],
      },
    ],
    nearMisses: [
      {
        name: 'read it and remember it',
        commands: ['cat /home/bowen/pod-manifest.txt'],
        because: 'reading is not recording; nothing of yours says where he went',
      },
      {
        name: 'write down the wrong part',
        commands: ["grep -i 'ration case' /home/bowen/pod-manifest.txt > logs/bowen.txt"],
        because: 'a real line from the right file, and not the heading',
      },
    ],
    onComplete: (world) => [
      '',
      'ORACLE: So that is where he aimed. One-one-four mark nine.',
      '',
      'ORACLE: Not a promise. Not a station. Just a heading in his own hand,',
      'ORACLE: and now it is in yours too.',
      '',
      ...(lunaAwake(world)
        ? [
            'LUNA: I ran it against every chart aboard before you woke up.',
            'LUNA: There is nothing there in any file we still have. Which is',
            'LUNA: not the same thing as saying there is nothing there.',
            '',
          ]
        : [
            'ORACLE: I have no chart that puts anything on that bearing. I am',
            'ORACLE: aware that my charts are one deck I can see and three I',
            'ORACLE: cannot, so that is worth exactly what it cost you.',
            '',
          ]),
    ],
    steps: [
      {
        id: 'record-heading',
        label: 'pull Bowen\'s heading into your own log',
        pending: (world) => !headingRecorded(world),
        rungs: [
          {
            tier: 'nudge',
            lines: [
              'Bowen left in pod 2 and wrote where he was going.',
              '',
              'Not in ORACLE. Not in me. In his own handwriting.',
              '',
              'Find the file in his quarters and copy the heading out.',
            ],
          },
          {
            tier: 'direction',
            track: 'cadet',
            lines: [
              'His note is in his home directory:',
              '',
              '    cat /home/bowen/pod-manifest.txt',
              '',
              'You are looking for the line that starts with Heading:.',
              '',
              'Then write that line into your own log under /home/dewitt/logs.',
            ],
          },
          {
            tier: 'direction',
            lines: [
              'You do not need the whole note, only the heading line.',
              '',
              'grep can pull one line out and > can write it to a file.',
              '',
              'Make yourself a record. You are going to need one.',
            ],
          },
          {
            tier: 'command',
            command: "grep -i '^Heading:' /home/bowen/pod-manifest.txt > /home/dewitt/logs/bowen-heading.txt",
            lines: [
              'Write only the heading line into your own log:',
              '',
              "    grep -i '^Heading:' /home/bowen/pod-manifest.txt > /home/dewitt/logs/bowen-heading.txt",
              '',
              'Then read what you wrote:  cat /home/dewitt/logs/bowen-heading.txt',
            ],
          },
        ],
      },
    ],
  },
  {
    id: 'map-v43',
    title: 'Map the storage nobody can reach',
    /*
     * Optional, and deliberately unresolved.
     *
     * This used to be a required objective that ended with ORACLE and LUNA
     * discussing a locked door, which put suspicion in the player's hands
     * before the rescue had landed. Act I does not accuse anybody. What the
     * player can establish here is topology -- a link pointing at an array
     * that is not attached -- and topology is not a motive.
     */
    // No `requires`, for the same reason as `trace-bowen`. `/opt/luna` is on
    // the disk from the first command precisely so a curious player can find
    // it before the story opens it; being silent about that was the bug.
    optional: true,
    done: v43Mapped,
    teaches: ['ls', 'readlink', 'grep'],
    routes: [
      { name: 'the long listing', commands: [`ls -l ${LUNA_DIR} > logs/luna.txt`] },
      { name: 'ask the link directly', commands: [`readlink ${LUNA_DIR}/v43 > logs/where.txt`] },
      {
        name: 'just the line that matters',
        commands: [`ls -l ${LUNA_DIR} | grep v43 > logs/v43.txt`],
      },
    ],
    nearMisses: [
      {
        name: 'look without writing anything down',
        commands: [`ls -l ${LUNA_DIR}`],
        because: 'the arrow was on screen and is now gone',
      },
      {
        name: 'record the directory instead of the link',
        commands: [`ls ${LUNA_DIR} > logs/luna.txt`],
        because: 'names without targets; a plain ls never shows where a link points',
      },
    ],
    onComplete: (world) => [
      '',
      ...(lunaAwake(world)
        ? [
            'LUNA: Yes. That is exactly the path I cannot reach either.',
            '',
          ]
        : []),
      'ORACLE: A link to a place that is no longer attached. It is not a',
      'ORACLE: permission problem and it is not a puzzle with a sudo answer.',
      'ORACLE: The array is simply not on this ship.',
      '',
      ...(lunaAwake(world)
        ? [
            'LUNA: Vasquez had a lot of directories. She had a lot of',
            'LUNA: everything. I would not read a great deal into one that',
            'LUNA: does not open.',
            '',
            'LUNA: I am saying that to you and also to me.',
            '',
          ]
        : [
            'ORACLE: It is named v43. I do not know what that is either, and',
            'ORACLE: I would rather say so than guess at it out loud.',
            '',
          ]),
      'ORACLE: You have written down where it points. That is the correct',
      'ORACLE: amount to do about a thing you cannot open yet.',
      '',
    ],
    steps: [
      {
        id: 'record-link',
        label: 'capture where v43 points',
        pending: (world) => !v43Mapped(world),
        rungs: [
          {
            tier: 'nudge',
            lines: [
              'There is a folder next to my weights called v43.',
              '',
              'It is visible. It is not readable. Those are different states.',
              '',
              'Write down where the link points.',
            ],
          },
          {
            tier: 'direction',
            track: 'cadet',
            lines: [
              'Use long listing so ls shows symlink targets with ->:',
              '',
              `    ls -l ${LUNA_DIR}`,
              '',
              'You are looking for the line with v43 on it.',
              '',
              'Save that listing into your own log file under /home/dewitt/logs.',
            ],
          },
          {
            tier: 'direction',
            lines: [
              'This is about recording evidence, not opening the path.',
              '',
              'If a path says No such file or directory to root as well, that',
              'is topology, not permissions. ls -l tells you topology.',
            ],
          },
          {
            tier: 'command',
            command: 'ls -l /opt/luna > /home/dewitt/logs/luna-v43-link.txt',
            lines: [
              'Capture the long listing in a file of your own:',
              '',
              '    ls -l /opt/luna > /home/dewitt/logs/luna-v43-link.txt',
              '',
              'Then verify it contains v43:  grep v43 /home/dewitt/logs/luna-v43-link.txt',
            ],
          },
        ],
      },
    ],
  },
];
