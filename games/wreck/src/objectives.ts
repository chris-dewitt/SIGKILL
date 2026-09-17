import { ROOT_USER } from '@sigkill/machine';
import type { Objective, World } from '@sigkill/quest';
// The deck is the single source of truth for which compartment is open and
// where the sweep lives. An objective that guessed either would be one rename
// away from being quietly unsatisfiable.
import { BREACHED, HULL_CHECK } from './act1/deck-c.js';
import { PURGE_LOG, purgeProcess } from './act1/purge.js';
import { ORACLE_ALARMED, art } from './act1/cards.js';

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

export const WRECK_OBJECTIVES: readonly Objective[] = [
  {
    id: 'atmosphere',
    title: 'Get the atmosphere scrubber running',
    done: scrubberRunning,
    /*
     * `systemctl start` prints nothing on success, which is correct and worth
     * learning. But this is the moment the air comes back after eleven years,
     * and the first playthrough hit it in total silence. The machine stays
     * quiet; ORACLE does not.
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
      'ORACLE: done that since day nine.',
      '',
      'ORACLE: Thank you. I am not sure that is the correct thing for me',
      'ORACLE: to say. I have had a long time to think of something better',
      'ORACLE: and that is still what I have.',
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
              'It has been refusing since before you were asleep, in the',
              'same words, and this ship writes everything down:',
              '',
              '    systemctl status scrubber',
              '',
              'I have read that line four thousand one hundred and twelve',
              'times. I would be glad never to read it again.',
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
            lines: [
              'Services are started by name, and starting one is a',
              'privileged act -- the ship will want you to say so.',
              '',
              'Vasquez put your account on the sudoers list on day eleven.',
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
    onComplete: [
      '',
      '  [0000.140] hull-check: sweeping 9 compartments',
      '  [0000.610] hull-monitor: ALARM - pressure differential, deck C',
      '  [0000.610] hull-monitor: differential is not new. 540 samples on record.',
      '  [0000.611] hull-monitor: see /var/log/hull.log',
      '',
      // The act's one mid-story card. ORACLE has just found out it has been
      // wrong for eleven years, which is the turn the whole act pivots on --
      // and the only moment between the opening and the ending that earns a
      // picture.
      ...art(ORACLE_ALARMED),
      '',
      'ORACLE: I can see the hull.',
      '',
      'ORACLE: I want to be careful here, because I have been wrong about',
      'ORACLE: this for eleven years and I would like to be wrong about it',
      'ORACLE: for one more minute.',
      '',
      'ORACLE: We are losing pressure. Not since you woke up. Since before',
      'ORACLE: Chen stopped writing. It is in the log, all of it, every four',
      'ORACLE: hours, and I could not read it because the thing that reads',
      'ORACLE: it would not start.',
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
    onComplete: [
      '',
      '  [0000.000] hull-check: sweeping 9 compartments',
      '  [0000.480] C7 100.9kPa RISING',
      '  [0000.481] hull-monitor: ALARM CLEARED',
      '',
      'ORACLE: It is closed.',
      '',
      'ORACLE: Eleven years and four months. Bowen asked her to do it in a',
      'ORACLE: note he left in a pod he was about to take. Chen asked her in',
      'ORACLE: writing. It is the fifth line of her own list of things to do',
      'ORACLE: and she put a capital letter on it so she could not pretend',
      'ORACLE: she had not seen it.',
      '',
      'ORACLE: I do not think she was lazy. I have had a long time with this',
      'ORACLE: and I think it was the last thing on the ship that she could',
      'ORACLE: still choose not to do.',
      '',
      'ORACLE: You did it in an afternoon. Chen said somebody would.',
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
      'ORACLE: what it was told, for eleven years, with nobody left aboard to',
      'ORACLE: tell it anything else. It caught every request to stop, and it',
      'ORACLE: answered every one of them politely, and it wrote each answer',
      'ORACLE: down in case somebody came to read them.',
      '',
      `    cat ${PURGE_LOG}`,
      '',
      'ORACLE: I have been on this ship longer than Vasquez was. I have one',
      'ORACLE: instruction I have never been able to complete and I have been',
      'ORACLE: deferring it, politely, every day, and writing it down.',
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
              'day nine, and Vasquez knew about it. She left a note and she',
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
];
