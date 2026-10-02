import { ROOT_USER, type Machine } from '@sigkill/machine';
import type { Objective, World } from '@sigkill/quest';
import { WORK } from './act1/floor.js';

export const DEPOSIT_TITLE = 'The Deposit';

/**
 * The host a goal is asking about.
 *
 * Every objective in this act is about a machine the player is not standing
 * on, which is what `World.network` exists for. Wordy at the edge so the
 * engine does not have to pretend every adventure is a fleet.
 */
export const host = (w: World, name: string): Machine | undefined =>
  w.network?.resolve(name)?.machine;

/**
 * Everything the player has written into their working directory.
 *
 * Objectives that ask for a finding assert on what is *recorded*, never on
 * what was typed and never on a filename this file chose. The Act I bug that
 * made this rule was a goal checking one hard-coded path while a player who
 * used their own name got nothing for doing the whole job.
 */
export function written(w: World): string {
  const out: string[] = [];
  const walk = (dir: string): void => {
    let entries: string[];
    try {
      entries = w.vfs.readdir(dir, ROOT_USER);
    } catch {
      return;
    }
    for (const name of entries) {
      const path = `${dir}/${name}`.replace(/\/+/g, '/');
      try {
        if (w.vfs.lstat(path, ROOT_USER).kind === 'dir') walk(path);
        else out.push(w.vfs.readText(path, ROOT_USER));
      } catch {
        // A dangling link or an unreadable file is not a finding.
      }
    }
  };
  walk(WORK);
  return out.join('\n');
}

const serviceState = (w: World, hostname: string, unit: string): string | undefined =>
  host(w, hostname)?.services.get(unit)?.state;

// ---------------------------------------------------------------------------

/**
 * 1. Know what you have.
 *
 * Pell's handover names three hosts and not one service, because he never
 * learned what any of them ran. `catalogue` is the word that proves somebody
 * looked: it is in no README, no handover and no health check, and the only
 * way to have written it down is to have asked a machine.
 */
const theFloor: Objective = {
  id: 'the-floor',
  title: 'Find out what is actually running, and write it down',
  teaches: ['ssh', 'systemctl', 'shell redirection'],
  done: (w) => {
    const text = written(w);
    // Word boundaries, so `index01` is not the unit `index` and `relay01` is
    // not the unit `relay`.
    return /\bcatalogue\b/.test(text) && /\bstore\b/.test(text) && /\brelay\b/.test(text);
  },
  routes: [
    {
      name: 'one file, three appends',
      commands: [
        "ssh vault01 'systemctl list-units' > ~/work/floor.txt",
        "ssh index01 'systemctl list-units' >> ~/work/floor.txt",
        "ssh relay01 'systemctl list-units' >> ~/work/floor.txt",
      ],
    },
    {
      name: 'a file per host',
      commands: [
        "ssh vault01 'systemctl list-units' > ~/work/vault.txt",
        "ssh index01 'systemctl list-units' > ~/work/index.txt",
        "ssh relay01 'systemctl list-units' > ~/work/relay.txt",
      ],
    },
    {
      name: 'through tee, with the hostname alongside',
      commands: [
        "ssh vault01 'hostname; systemctl list-units' | tee ~/work/floor.txt",
        "ssh index01 'hostname; systemctl list-units' >> ~/work/floor.txt",
        "ssh relay01 'hostname; systemctl list-units' >> ~/work/floor.txt",
      ],
    },
    {
      name: 'reading the unit files instead of asking systemctl',
      commands: [
        "ssh vault01 'ls /etc/systemd/system' > ~/work/floor.txt",
        "ssh index01 'ls /etc/systemd/system' >> ~/work/floor.txt",
        "ssh relay01 'ls /etc/systemd/system' >> ~/work/floor.txt",
      ],
    },
  ],
  nearMisses: [
    {
      name: "copying Pell's handover",
      because:
        'The handover names the hosts and not one service. Copying it records what ' +
        'you were told, which is the thing this objective exists to get past.',
      commands: ['cp ~/PELL ~/work/floor.txt'],
    },
    {
      name: 'copying the health check',
      because:
        'check.sh names index01 and relay01 and nothing that runs on them. It is ' +
        'also the file that has been lying for a month.',
      commands: ['cp /opt/deposit/check.sh ~/work/floor.txt'],
    },
    {
      name: 'the two hosts anybody would think of',
      because:
        'vault01 and relay01 are both in the handover, so a player can reach them ' +
        'without learning anything. The catalogue is the one nobody mentioned.',
      commands: [
        "ssh vault01 'systemctl list-units' > ~/work/floor.txt",
        "ssh relay01 'systemctl list-units' >> ~/work/floor.txt",
      ],
    },
  ],
  steps: [
    {
      id: 'look-at-one',
      label: 'see what one host runs',
      pending: (w) => !/\bstore\b/.test(written(w)),
      rungs: [
        {
          tier: 'nudge',
          lines: [
            'Pell handed you three machines and told you what none of them do.',
            'They will tell you themselves.',
          ],
        },
        {
          tier: 'direction',
          lines: [
            "You can run a command on another machine without leaving this one:",
            "ssh <host> '<command>'. systemctl is what knows about services.",
          ],
        },
        {
          tier: 'command',
          lines: ['Start with the store.'],
          command: "ssh vault01 'systemctl list-units' > ~/work/floor.txt",
        },
      ],
    },
    {
      id: 'all-three',
      label: 'and the other two',
      pending: (w) => {
        const text = written(w);
        return !(/\bcatalogue\b/.test(text) && /\brelay\b/.test(text));
      },
      rungs: [
        {
          tier: 'nudge',
          lines: ['One of the three is running something nobody has mentioned to you.'],
        },
        {
          tier: 'direction',
          lines: [
            '> writes a file. >> adds to one that is already there, which is how',
            'three answers end up in one place.',
          ],
        },
        {
          tier: 'command',
          lines: ['index01 is the one with the surprise on it.'],
          command: "ssh index01 'systemctl list-units' >> ~/work/floor.txt",
        },
      ],
    },
  ],
};

/**
 * 2. The check that lied.
 *
 * The pivot. `curl URL && echo healthy` has printed `index healthy` every
 * morning for a month while every request to that URL came back 500, because
 * an HTTP error is a successful transfer and curl exits 0.
 *
 * The goal asks for the finding rather than the fix: the status that has been
 * coming back, and some sign the player understood why nobody saw it. `-f`,
 * reading the body and asking for the headers are all real ways there, so all
 * three are routes.
 */
const theCheckThatLied: Objective = {
  id: 'the-check-that-lied',
  title: 'Work out how a month of green checks missed a dead service',
  teaches: ['curl', 'exit status', 'shell redirection'],
  requires: ['the-floor'],
  done: (w) => {
    const text = written(w);
    return /\b500\b/.test(text) && /exit|status|-f|--fail|succe/i.test(text);
  },
  routes: [
    {
      name: 'ask curl to treat an HTTP error as a failure',
      commands: [
        'curl -f http://index01/health 2> ~/work/finding.txt',
        'echo "curl exits 0 on an HTTP error, so check.sh called a 500 healthy" >> ~/work/finding.txt',
      ],
    },
    {
      name: 'keep the body, which says it plainly',
      commands: [
        'curl http://index01/health > ~/work/finding.txt',
        'echo "500 - and the exit status was 0, so the check passed" >> ~/work/finding.txt',
      ],
    },
    {
      name: 'the headers',
      commands: [
        'curl -I http://index01/health > ~/work/finding.txt',
        'echo "HTTP 500 and curl exit status 0. That is why it looked healthy." >> ~/work/finding.txt',
      ],
    },
  ],
  nearMisses: [
    {
      name: 'copying the check itself',
      because:
        'The script is the thing that was wrong. Recording it records the question ' +
        'rather than the answer, and names no status at all.',
      commands: ['cp /opt/deposit/check.sh ~/work/finding.txt'],
    },
    {
      name: 'running the check and keeping what it prints',
      because:
        'It prints "index healthy", which is exactly the lie. A finding that repeats ' +
        'it has established nothing.',
      commands: ['/opt/deposit/check.sh > ~/work/finding.txt'],
    },
    {
      name: 'the service state, which looks fine',
      because:
        '`systemctl status index` says active and has said active all month. Being ' +
        'up is not the same as being right, and that gap is the whole act.',
      commands: ["ssh index01 'systemctl status index' > ~/work/finding.txt"],
    },
  ],
  steps: [
    {
      id: 'run-it',
      label: 'see what the index really answers',
      pending: (w) => !/\b500\b/.test(written(w)),
      rungs: [
        {
          tier: 'nudge',
          lines: [
            'Pell runs that check every morning and it is green every morning.',
            'Run it. Then ask the same machine the same question yourself.',
          ],
        },
        {
          tier: 'direction',
          lines: [
            'curl prints what came back. Reading that, and asking whether curl was',
            'happy, are two different questions with two different answers here.',
          ],
        },
        {
          tier: 'command',
          lines: ['Ask curl to treat an HTTP error as a failure:'],
          command: 'curl -f http://index01/health 2> ~/work/finding.txt',
        },
      ],
    },
    {
      id: 'say-why',
      label: 'write down why nobody saw it',
      pending: (w) => !/exit|status|-f|--fail|succe/i.test(written(w)),
      rungs: [
        {
          tier: 'nudge',
          lines: ['The check was not broken. It was answering a different question.'],
        },
        {
          tier: 'direction',
          lines: [
            'An HTTP error is a successful transfer: the server was reached and it',
            'answered. curl exits 0, and `&& echo healthy` believes it.',
          ],
        },
        {
          tier: 'command',
          lines: ['Put that in the file, in your own words:'],
          command:
            'echo "curl exits 0 on an HTTP error, so check.sh called a 500 healthy" >> ~/work/finding.txt',
        },
      ],
    },
  ],
};

/**
 * 3. Why it will not start.
 *
 * The obvious move, once the index is known to be sick, is to restart it --
 * and the restart is refused, naming `catalogue.service`. That refusal is the
 * lesson, and it is also the explanation for the whole month: `Requires=` is
 * checked when a unit *starts*. Nothing stops a running unit when the thing
 * it required goes away, which is why the index has been up without its
 * datastore since the first of July.
 */
const whyItWillNotStart: Objective = {
  id: 'why-it-will-not-start',
  title: 'Get the index answering again',
  teaches: ['systemctl', 'journalctl', 'service dependencies'],
  requires: ['the-check-that-lied'],
  done: (w) =>
    serviceState(w, 'index01', 'catalogue') === 'active' &&
    serviceState(w, 'index01', 'index') === 'active',
  routes: [
    {
      name: 'start the thing it needs',
      commands: ["ssh index01 'sudo systemctl start catalogue'"],
    },
    {
      name: 'try the restart first, be refused, then fix the cause',
      commands: [
        "ssh index01 'sudo systemctl stop index'",
        "ssh index01 'sudo systemctl start catalogue'",
        "ssh index01 'sudo systemctl start index'",
      ],
    },
    {
      name: 'from inside the host',
      commands: ['ssh index01', 'sudo systemctl start catalogue', 'exit'],
    },
    {
      name: 'restart both, in the order the unit file asks for',
      commands: [
        "ssh index01 'sudo systemctl restart catalogue'",
        "ssh index01 'sudo systemctl restart index'",
      ],
    },
  ],
  nearMisses: [
    {
      name: 'deleting the lock file',
      because:
        'The lock names the pid and the minute the datastore died. It is evidence, ' +
        'not the cause, and removing it changes nothing about what is running.',
      commands: ["ssh root@index01 'rm /var/lib/index/catalogue.lock'"],
    },
    {
      name: 'restarting the relay, which was never the problem',
      because:
        'The relay has been healthy throughout. It is the index that has been ' +
        'answering 500.',
      commands: ["ssh relay01 'sudo systemctl restart relay'"],
    },
    {
      name: 'stopping the index so it stops complaining',
      because:
        'It leaves the catalogue dead and the index dead, which is worse than where ' +
        'it started -- and `Requires=` will now refuse to bring the index back.',
      commands: ["ssh index01 'sudo systemctl stop index'"],
    },
  ],
  steps: [
    {
      id: 'find-the-cause',
      label: 'find what the index is missing',
      pending: (w) => serviceState(w, 'index01', 'catalogue') !== 'active',
      rungs: [
        {
          tier: 'nudge',
          lines: [
            'The index is running, and it says the catalogue is unavailable.',
            'Those are two different services.',
          ],
        },
        {
          tier: 'direction',
          lines: [
            'systemctl list-units on index01 shows both and their states. The index',
            'unit file says what it needs; journalctl -u says when it last ran.',
          ],
        },
        {
          tier: 'command',
          lines: ['Start the datastore the index has been missing:'],
          command: "ssh index01 'sudo systemctl start catalogue'",
        },
      ],
    },
    {
      id: 'index-up',
      label: 'and leave the index running',
      pending: (w) => serviceState(w, 'index01', 'index') !== 'active',
      rungs: [
        {
          tier: 'nudge',
          lines: ['Something stopped the index on the way past. It needs to be up too.'],
        },
        {
          tier: 'direction',
          lines: [
            'With the catalogue active the index will start: Requires= only refuses',
            'while the thing it needs is missing.',
          ],
        },
        {
          tier: 'command',
          lines: ['Bring it back:'],
          command: "ssh index01 'sudo systemctl start index'",
        },
      ],
    },
  ],
};

/**
 * 4. Make the check tell the truth.
 *
 * Fixing the index fixes today. The check that failed to notice is still the
 * check, and a floor where the same thing can happen again silently has not
 * really been repaired. `-f` is the one-character answer, and the goal takes
 * it wherever the player puts it -- editing Pell's script in place or writing
 * their own is the same repair.
 */
const shipIt: Objective = {
  id: 'ship-it',
  title: 'Fix the health check so it would have caught this',
  teaches: ['sed', 'curl', 'shell redirection'],
  requires: ['why-it-will-not-start'],
  done: (w) => {
    let pells = '';
    try {
      pells = w.vfs.readText('/opt/deposit/check.sh', ROOT_USER);
    } catch {
      // Deleted, which is a legitimate thing to have done if the player wrote
      // their own.
    }
    const text = `${pells}\n${written(w)}`;
    // curl, told to treat an HTTP error as a failure, aimed at the index.
    return /curl[^\n]*(\s-[A-Za-z]*f\b|--fail)/.test(text) && /index01/.test(text);
  },
  routes: [
    {
      name: "edit Pell's script where it stands",
      commands: ["sudo sed -i 's|curl http://index01|curl -f http://index01|' /opt/deposit/check.sh"],
    },
    {
      name: 'write your own and leave his alone',
      commands: [
        'echo "#!/bin/sh" > ~/work/check.sh',
        'echo "curl -f http://index01/health" >> ~/work/check.sh',
        'chmod 755 ~/work/check.sh',
      ],
    },
    {
      name: 'copy it, fix the copy',
      commands: [
        'cp /opt/deposit/check.sh ~/work/check.sh',
        "sed -i 's|curl http://index01|curl --fail http://index01|' ~/work/check.sh",
      ],
    },
  ],
  nearMisses: [
    {
      name: 'making it louder without making it right',
      because:
        'Printing more does not change what curl reports. The check would still ' +
        'pass on a 500, which is the entire failure.',
      commands: ['echo "echo checking index01" >> ~/work/check.sh'],
    },
    {
      name: 'checking that the service is running',
      because:
        'The index was running the whole month. `systemctl status` would have said ' +
        'active every morning, which is exactly what nobody should have trusted.',
      commands: ["echo \"ssh index01 'systemctl status index'\" > ~/work/check.sh"],
    },
    {
      name: 'curl with no flags at all, written out fresh',
      because:
        'Identical to the check that has been green for a month. An HTTP error is ' +
        'still a successful transfer.',
      commands: ['echo "curl http://index01/health" > ~/work/check.sh'],
    },
  ],
  steps: [
    {
      id: 'make-it-fail',
      label: 'make the check fail on a 500',
      pending: (w) => {
        let pells = '';
        try {
          pells = w.vfs.readText('/opt/deposit/check.sh', ROOT_USER);
        } catch {
          /* fine */
        }
        return !/curl[^\n]*(\s-[A-Za-z]*f\b|--fail)/.test(`${pells}\n${written(w)}`);
      },
      rungs: [
        {
          tier: 'nudge',
          lines: [
            'The index is fixed. The check that missed it for a month is not.',
            'It can be made to notice with one flag.',
          ],
        },
        {
          tier: 'direction',
          lines: [
            'curl has a flag for "an HTTP error is a failure". Read: man curl.',
            "Pell's script is root-owned, so editing it in place needs sudo.",
          ],
        },
        {
          tier: 'command',
          lines: ['Either fix his, or keep your own. This fixes his:'],
          command: "sudo sed -i 's|curl http://index01|curl -f http://index01|' /opt/deposit/check.sh",
        },
      ],
    },
  ],
};

/**
 * 5. Not a DNS problem.
 *
 * `mirror.sh` has been failing every night for however long, and the name in
 * it -- `vault02` -- appears nowhere else on the floor. A player meets it
 * inside a failure rather than on a list, which is how you meet most hosts.
 *
 * Three things it could be, and only one of them is true: the name is wrong,
 * the host is off, or the service is gone. All three tools say the same thing
 * about this one, and they say *powered off*. Getting that distinction right
 * is the difference between an hour spent on the resolver and thirty seconds
 * spent on a power supply.
 */
const notADnsProblem: Objective = {
  id: 'not-a-dns-problem',
  title: "Find out why Pell's mirror has been failing, and what kind of failure it is",
  teaches: ['ssh', 'nc', 'ping'],
  requires: ['why-it-will-not-start'],
  done: (w) => {
    const text = written(w);
    // The host, and the right one of the three answers. A finding that says
    // the name is unknown is wrong and must not count.
    return /vault02/i.test(text) && /no route|powered|is off|is down|unreachable/i.test(text);
  },
  routes: [
    {
      name: 'run the thing that has been failing',
      commands: [
        "ssh relay01 '/usr/local/bin/mirror.sh' 2> ~/work/mirror.txt",
        'echo "vault02 is powered off - the name resolves, there is no route" >> ~/work/mirror.txt',
      ],
    },
    {
      name: 'ask each tool in turn',
      commands: [
        'ping -c 1 vault02 > ~/work/mirror.txt',
        'nc -z vault02 22 2>> ~/work/mirror.txt',
        'echo "vault02: no route to host. It is off, not missing." >> ~/work/mirror.txt',
      ],
    },
    {
      name: 'ssh, and keep what it said',
      commands: [
        "ssh vault02 'echo hi' 2> ~/work/mirror.txt",
        'echo "no route to host: vault02 is down" >> ~/work/mirror.txt',
      ],
    },
  ],
  nearMisses: [
    {
      name: 'calling it a name that does not exist',
      because:
        'It does exist and it resolves. Every tool says "no route to host", which ' +
        'is a different failure from "could not resolve" and sends you somewhere ' +
        'different.',
      commands: ['echo "mirror fails: vault02 is an unknown host, bad DNS" > ~/work/mirror.txt'],
    },
    {
      name: 'copying the script that fails',
      because:
        'The script is the symptom. Recording it records that something is wrong, ' +
        'not which of the three things it is.',
      commands: ["ssh relay01 'cat /usr/local/bin/mirror.sh' > ~/work/mirror.txt"],
    },
    {
      name: 'a host that really is missing',
      because:
        'vault03 does not exist, and the error says so in different words. That is ' +
        'the contrast, not the finding.',
      commands: ["ssh vault03 'echo hi' 2> ~/work/mirror.txt"],
    },
  ],
  steps: [
    {
      id: 'find-the-name',
      label: 'find what the mirror is trying to reach',
      pending: (w) => !/vault02/i.test(written(w)),
      rungs: [
        {
          tier: 'nudge',
          lines: ['There is a fifth name on this floor and it is not in the handover.'],
        },
        {
          tier: 'direction',
          lines: ['relay01 has a script in /usr/local/bin that Pell wrote and stopped watching.'],
        },
        {
          tier: 'command',
          lines: ['Run it and keep what it says:'],
          command: "ssh relay01 '/usr/local/bin/mirror.sh' 2> ~/work/mirror.txt",
        },
      ],
    },
    {
      id: 'which-failure',
      label: 'say which of the three it is',
      pending: (w) => !/no route|powered|is off|is down|unreachable/i.test(written(w)),
      rungs: [
        {
          tier: 'nudge',
          lines: [
            'A name that is wrong, a host that is off, and a service that is gone',
            'are three different problems. They do not read the same.',
          ],
        },
        {
          tier: 'direction',
          lines: [
            '"Could not resolve" means the name. "No route to host" means the',
            'machine. "Connection refused" means the machine is there and the',
            'service is not. Compare vault02 with a name you invent.',
          ],
        },
        {
          tier: 'command',
          lines: ['Write down which one it is:'],
          command:
            'echo "vault02 is powered off - the name resolves, there is no route" >> ~/work/mirror.txt',
        },
      ],
    },
  ],
};

/**
 * 6. After the reboot.
 *
 * Starting the catalogue fixed today. Nothing has fixed tomorrow: it was never
 * enabled, which is why a datastore that died on the first was still dead on
 * the fourteenth. `enable` is a symlink in multi-user.target.wants, so the
 * repair is visible to `ls` and survives a snapshot -- and `After=`, already
 * in the unit file, is what stops the index losing the race at the next boot.
 */
const afterTheReboot: Objective = {
  id: 'after-the-reboot',
  title: 'Make sure the catalogue comes back by itself',
  teaches: ['systemctl', 'ln', 'ls'],
  requires: ['why-it-will-not-start'],
  done: (w) =>
    host(w, 'index01')?.services.isEnabled('catalogue') === true &&
    host(w, 'index01')?.services.isEnabled('index') === true,
  routes: [
    {
      name: 'enable it',
      commands: ["ssh index01 'sudo systemctl enable catalogue'"],
    },
    {
      name: 'from inside the host',
      commands: ['ssh index01', 'sudo systemctl enable catalogue', 'exit'],
    },
    {
      name: 'the symlink by hand, because that is all enable is',
      commands: [
        "ssh index01 'sudo ln -s /etc/systemd/system/catalogue.service " +
          "/etc/systemd/system/multi-user.target.wants/catalogue.service'",
      ],
    },
  ],
  nearMisses: [
    {
      name: 'starting it again',
      because:
        'It is already running. Starting a running unit changes nothing about what ' +
        'happens at the next boot, which is the only thing this objective is about.',
      commands: ["ssh index01 'sudo systemctl start catalogue'"],
    },
    {
      name: 'enabling the one that was never the problem',
      because: 'The index has been enabled all along. The catalogue is the one nobody enabled.',
      commands: ["ssh index01 'sudo systemctl enable index'"],
    },
    {
      name: 'enabling it on the wrong host',
      because:
        'There is no catalogue on vault01. systemctl says so, and the index is still ' +
        'one power cut from being down for another month.',
      commands: ["ssh vault01 'sudo systemctl enable catalogue'"],
    },
  ],
  steps: [
    {
      id: 'enable-it',
      label: 'make it start at boot',
      pending: (w) => host(w, 'index01')?.services.isEnabled('catalogue') !== true,
      rungs: [
        {
          tier: 'nudge',
          lines: [
            'It is running because you started it. Ask what happens the next time',
            'that machine is power-cycled.',
          ],
        },
        {
          tier: 'direction',
          lines: [
            'Running and enabled are two different states. systemctl list-units',
            'shows both, and enabling is a symlink you can see with ls.',
          ],
        },
        {
          tier: 'command',
          lines: ['So it comes back by itself:'],
          command: "ssh index01 'sudo systemctl enable catalogue'",
        },
      ],
    },
  ],
};

export const DEPOSIT_OBJECTIVES: Objective[] = [
  theFloor,
  theCheckThatLied,
  whyItWillNotStart,
  shipIt,
  notADnsProblem,
  afterTheReboot,
];
