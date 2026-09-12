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
              'The scrubber did not just fail. It refused.',
              'It said why, at the time, and this ship writes everything down.',
            ],
          },
          {
            tier: 'direction',
            track: 'cadet',
            lines: [
              'Two places keep a record. /var/log/boot.log is what happened',
              'during the cold start, and `systemctl status scrubber` is what',
              'the controller thinks right now.',
              '',
              'To read a file: cat /var/log/boot.log',
            ],
          },
          {
            tier: 'direction',
            lines: [
              'systemctl status scrubber names the number it objects to.',
              'The number lives in /etc/life_support.conf. Breathable is 19',
              'to 23 and it is currently set well below that -- Vasquez was',
              'stretching the reserve and the controller would not play along.',
            ],
          },
          {
            tier: 'command',
            command: "sed -i 's/^O2_TARGET=.*/O2_TARGET=21/' /etc/life_support.conf",
            lines: [
              'Set the target to something it will accept. Any route works:',
              '',
              "    sed -i 's/^O2_TARGET=.*/O2_TARGET=21/' /etc/life_support.conf",
              '',
              'The file is writable by you. I do not care how the 21 gets',
              'there, only that it does.',
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
