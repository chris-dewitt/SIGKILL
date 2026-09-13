import { ROOT_USER } from '@sigkill/machine';
import type { Objective, World } from '@sigkill/quest';

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

export const WRECK_OBJECTIVES: readonly Objective[] = [
  {
    id: 'atmosphere',
    title: 'Get the atmosphere scrubber running',
    done: scrubberRunning,
    steps: [
      {
        id: 'raise-target',
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
    steps: [
      {
        id: 'enable-it',
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
];
