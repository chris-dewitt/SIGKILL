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
              'The scrubber did not fail. It refused, and it said why.',
              'Ask it yourself:',
              '',
              '    systemctl status scrubber',
              '',
              'I have been reading that same line for eleven years.',
            ],
          },
          {
            tier: 'direction',
            track: 'cadet',
            lines: [
              'It is refusing a number it was given.',
              '',
              'Settings on this ship live in one place. Look at it:',
              '',
              '    ls /etc',
              '',
              'The one you want has life support in the name. To read a file,',
              'put cat in front of it:  cat /etc/life_support.conf',
            ],
          },
          {
            tier: 'direction',
            lines: [
              'The number is O2_TARGET, and it lives in /etc with every other',
              'setting this ship has -- ls /etc if you want to see the shape of',
              'the place.',
              '',
              'Breathable is 19 to 23. Vasquez set it to 16 to stretch the',
              'reserve and the controller has thrown it out ever since.',
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
              'If you would rather not open anything, one line does it:',
              '',
              "    sed -i 's/^O2_TARGET=.*/O2_TARGET=21/' /etc/life_support.conf",
              '',
              'The file is yours to write. I do not care how the 21 gets there,',
              'only that it does.',
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
              'The number is right now. The scrubber has not noticed.',
              'Nothing on this ship restarts itself any more.',
            ],
          },
          {
            tier: 'direction',
            lines: [
              'Services are started by name, and starting one is a privileged',
              'act. Vasquez left your account on the sudoers list, which is',
              'the only reason this is possible at all.',
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
              'If this ship browns out tonight, the scrubber does not come',
              'back, and I cannot wake you a second time.',
            ],
          },
          {
            tier: 'direction',
            lines: [
              'Starting a service and enabling it are different things.',
              'One is now. The other is every boot from here on.',
              'The reactor is already enabled -- compare the two.',
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
