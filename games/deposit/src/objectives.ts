import { ROOT_USER, type Machine } from '@sigkill/machine';
import { asArt, type BeatLine, type Objective, type World } from '@sigkill/quest';
import { HIS_MATTER, WORK } from './act1/floor.js';
import { ACCESS_LOG } from './store.js';

export const DEPOSIT_TITLE = 'The Deposit';

/**
 * The act, as three rows.
 *
 * Not a logo. The gap between a service being up and a service being right is
 * the whole of this game, and it fits on a phone with eight columns spare.
 */
export const DEPOSIT_ART: BeatLine[] = asArt([
  '  systemctl says   index active',
  '  curl says        200 OK',
  '  the index says   500 catalogue',
  '                       unavailable',
]);

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

/**
 * The store's access record, as it stands on the machine that keeps it.
 *
 * Read from vault01 rather than from anything the player wrote, which is the
 * entire point of it: a record is only evidence while it is still the
 * original. An objective that accepted a copy would accept a copy that had
 * been edited, and `clean-hands` is precisely the objective where that
 * distinction is the lesson.
 *
 * Missing reads as empty, and the goal that uses it requires the record to
 * still say what it said -- so deleting the log fails the objective instead of
 * passing it.
 */
const accessRecord = (w: World): string => {
  try {
    return host(w, 'vault01')?.vfs.readText(ACCESS_LOG, ROOT_USER) ?? '';
  } catch {
    return '';
  }
};

/** A line of the access record: who read which matter. */
const readBy = (who: string): RegExp => new RegExp(`\\b${who}\\s+${HIS_MATTER}/`);

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
    /*
     * One step per host, rather than one step for "the other two".
     *
     * The ladder used to end at index01 while the goal wanted all three, so a
     * player who took every hint was left one host short and told nothing
     * about it. `hints.test.ts` is what found that, by running each bottom
     * rung and asserting its step stops being pending.
     */
    {
      id: 'the-surprise',
      label: 'and the host nobody mentioned',
      pending: (w) => !/\bcatalogue\b/.test(written(w)),
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
    {
      id: 'and-the-third',
      label: 'and the one that talks to the tribunal',
      pending: (w) => !/\brelay\b/.test(written(w)),
      rungs: [
        {
          tier: 'nudge',
          lines: ['Three hosts were handed to you. Two of them are in your notes.'],
        },
        {
          tier: 'direction',
          lines: [
            'relay01 is the one that hands deposited material to the tribunal.',
            'Whatever it runs, it is the thing an outsider actually talks to.',
          ],
        },
        {
          tier: 'command',
          lines: ['The last of the three:'],
          command: "ssh relay01 'systemctl list-units' >> ~/work/floor.txt",
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

/**
 * 7. Serve the matter.
 *
 * The job, finally doable, and the first thing on this floor that is for
 * somebody rather than about it. The tribunal asked for 7719; the index says
 * where 7719 lives; the store has it. Three machines, one answer, and none of
 * it possible an hour ago because the index was returning 500 to everybody.
 *
 * It is also where the player meets the store's own tool, because the
 * material is 0600 and `cat` will not open it. `deposit get` reads on your
 * behalf and writes a line saying you asked -- which is the first time the act
 * says out loud that retrieval is a recorded act, and it says it while the
 * matter in question is somebody else's.
 *
 * It is also where the act quietly makes its point. The request names a
 * matter that is not his, and nothing on this floor will ever ask him for the
 * one that is.
 */
const serveTheMatter: Objective = {
  id: 'serve-the-matter',
  title: 'Get the tribunal the matter they asked for',
  teaches: ['curl', 'scp', 'shell redirection', 'the deposit store'],
  requires: ['why-it-will-not-start'],
  done: (w) => {
    const text = written(w);
    // The manifest's own words, which exist only on vault01 and can only be
    // found by asking the index where to look.
    return /\bmatter 7719\b/.test(text) && /filed 2398-05-02/.test(text);
  },
  routes: [
    {
      name: 'ask the index, then ask the store',
      commands: [
        'curl http://index01/matter/7719 > ~/work/where.txt',
        "ssh vault01 'deposit get 7719/manifest' > ~/work/7719.txt",
      ],
    },
    {
      name: 'stage it on the store and copy it back',
      commands: [
        'curl http://index01/matter/7719',
        "ssh vault01 'deposit list'",
        "ssh vault01 'deposit get 7719/manifest > /tmp/7719.txt'",
        'scp vault01:/tmp/7719.txt ~/work/7719.txt',
      ],
    },
    {
      name: 'from inside the store',
      commands: [
        'curl http://index01/matter/7719',
        'ssh vault01',
        'deposit get 7719/manifest',
        'exit',
        "ssh vault01 'deposit get 7719/manifest' | tee ~/work/7719.txt",
      ],
    },
  ],
  nearMisses: [
    {
      name: 'the index answer on its own',
      because:
        'It says where the matter is filed, which is a path and not a manifest. ' +
        'The tribunal asked for the document.',
      commands: ['curl http://index01/matter/7719 > ~/work/7719.txt'],
    },
    {
      name: 'the request itself',
      because: 'That is what was asked for, not what was retrieved.',
      commands: ['cp ~/REQUEST ~/work/7719.txt'],
    },
    {
      name: 'a different matter',
      because:
        'Close enough to pass a careless check and wrong enough to be a serious ' +
        'thing to hand a tribunal. They asked for 7719, and the store has now ' +
        'written down that somebody went looking in 7701.',
      commands: ["ssh vault01 'deposit get 7701/manifest' > ~/work/7719.txt"],
    },
    {
      name: 'opening the file',
      because:
        'Deposited material is 0600 and owned by the store, so cat gets Permission ' +
        'denied and the redirect leaves an empty file. Nothing here is readable by ' +
        'being opened, which is what makes the access record worth reading.',
      commands: ["ssh vault01 'cat /srv/deposit/7719/manifest' > ~/work/7719.txt"],
    },
  ],
  steps: [
    {
      id: 'find-it',
      label: 'find where 7719 is filed',
      /*
       * What the index answers is a host and a path -- `7719
       * vault01:/srv/deposit/7719` -- and not the manifest. This used to ask
       * for the manifest's own words, so taking the hint changed nothing the
       * step could see, which is the exact failure `hints.test.ts` exists to
       * catch. The step asks for what the step produces.
       */
      pending: (w) => !/\/srv\/deposit\/7719\b/.test(written(w)),
      rungs: [
        {
          tier: 'nudge',
          lines: [
            'The tribunal asked for a matter number. The index is the thing that',
            'turns a number into a place -- which is why it mattered that it works.',
          ],
        },
        {
          tier: 'direction',
          lines: ['curl http://index01/matter/<number> answers with the host and the path.'],
        },
        {
          tier: 'command',
          lines: ['Ask it:'],
          command: 'curl http://index01/matter/7719 > ~/work/where.txt',
        },
      ],
    },
    {
      id: 'fetch-it',
      label: 'and bring back the manifest',
      pending: (w) => !/filed 2398-05-02/.test(written(w)),
      rungs: [
        {
          tier: 'nudge',
          lines: [
            'A path is not a document. The store is the machine that has it, and',
            'the files there do not open: try it and read what it says.',
          ],
        },
        {
          tier: 'direction',
          lines: [
            'vault01 has a command of its own for this. ssh over and run help, or',
            'man deposit, and read what it says about the access log while you are',
            'there.',
          ],
        },
        {
          tier: 'command',
          lines: ['Ask the store for it:'],
          command: "ssh vault01 'deposit get 7719/manifest' > ~/work/7719.txt",
        },
      ],
    },
  ],
};

/**
 * 8. The second lie, and the sharper one.
 *
 * Objective two taught `-f`. This is the floor pointing out that `-f` was not
 * the lesson.
 *
 * `relay01`'s health endpoint is a *file*. It is served off the filesystem,
 * so it answers 200 whether or not `relayd` is running -- and `curl -f` passes
 * it happily with the relay stopped dead. A player who learned "add -f and the
 * check is fixed" has learned the wrong half. The right half is that a health
 * check has to exercise the thing it claims to check, and the only way to know
 * whether yours does is to break the thing and watch.
 *
 * Which is also the only objective here that asks the player to stop something
 * in order to learn about it. That is deliberate: it is what a staging check
 * is for, and the relay comes straight back.
 */
const theSecondLie: Objective = {
  id: 'the-second-lie',
  title: "Find out whether the relay's check tests the relay",
  teaches: ['curl', 'systemctl', 'health checks'],
  requires: ['ship-it'],
  done: (w) => {
    const text = written(w);
    return (
      /relay/i.test(text) &&
      /static|a file|does not test|regardless|still (answers|200|ok)|even when|while .*stopped/i.test(
        text,
      )
    );
  },
  routes: [
    {
      name: 'stop it and ask again',
      commands: [
        "ssh relay01 'sudo systemctl stop relay'",
        'curl -f http://relay01/health > ~/work/relay.txt',
        'echo "relay stopped, and the check still answers ok - it is a static file" >> ~/work/relay.txt',
        "ssh relay01 'sudo systemctl start relay'",
      ],
    },
    {
      name: 'look at what is being served',
      commands: [
        "ssh relay01 'ls /srv/http' > ~/work/relay.txt",
        "ssh relay01 'cat /srv/http/health' >> ~/work/relay.txt",
        'echo "relay health is a file on disk, so it does not test relayd at all" >> ~/work/relay.txt',
      ],
    },
    {
      name: 'both, and write it up properly',
      commands: [
        "ssh relay01 'sudo systemctl stop relay'",
        "ssh relay01 'systemctl status relay' > ~/work/relay.txt",
        'curl -f http://relay01/health >> ~/work/relay.txt',
        'echo "even when stopped the endpoint returns 200: static, not a real check" >> ~/work/relay.txt',
        "ssh relay01 'sudo systemctl start relay'",
      ],
    },
  ],
  nearMisses: [
    {
      name: 'running the check and seeing it pass',
      because:
        'It passes. It passed before you started and it would pass with the relay ' +
        'in pieces, which is the thing to find out and not the thing to record.',
      commands: ['curl -f http://relay01/health > ~/work/relay.txt'],
    },
    {
      name: 'the service state on its own',
      because:
        'systemctl tells you the relay is running. It says nothing about whether ' +
        'the check would notice if it were not.',
      commands: ["ssh relay01 'systemctl status relay' > ~/work/relay.txt"],
    },
    {
      name: 'adding -f and calling it done',
      because:
        '-f was objective four. It makes curl honest about HTTP errors and does ' +
        'nothing at all about an endpoint that was never going to return one.',
      commands: ['echo "curl -f http://relay01/health" > ~/work/relay.txt'],
    },
  ],
  steps: [
    {
      id: 'break-it',
      label: 'find out what the check would notice',
      /*
       * Stopping the relay writes nothing down, so a step asking only about
       * notes could not be cleared by its own hint. It is cleared by the relay
       * being stopped -- the thing the step is actually asking for -- or by
       * there already being something recorded, so a player who looked,
       * restarted it and wrote it up is not sent back to stop it again.
       */
      pending: (w) =>
        serviceState(w, 'relay01', 'relay') === 'active' && !/relay/i.test(written(w)),
      rungs: [
        {
          tier: 'nudge',
          lines: [
            'You fixed the index check. The relay has a check too, and it has been',
            'green just as long.',
          ],
        },
        {
          tier: 'direction',
          lines: [
            'The only way to know what a check would catch is to break the thing',
            'and watch. Stop the relay. It will come straight back.',
          ],
        },
        {
          tier: 'command',
          lines: ['Stop it, then ask the endpoint:'],
          command: "ssh relay01 'sudo systemctl stop relay'",
        },
      ],
    },
    {
      id: 'say-what-it-is',
      label: 'write down why it still passes',
      pending: (w) =>
        !/static|a file|does not test|regardless|still (answers|200|ok)|even when|while .*stopped/i.test(
          written(w),
        ),
      rungs: [
        {
          tier: 'nudge',
          lines: ['With the relay stopped, the endpoint still answers. Ask what is answering.'],
        },
        {
          tier: 'direction',
          lines: [
            '/srv/http on relay01 is served straight off the disk. The file is the',
            'answer, and the file does not care whether relayd is alive.',
          ],
        },
        {
          tier: 'command',
          lines: ['Record what that means:'],
          command:
            'echo "relay stopped, and the check still answers ok - it is a static file" >> ~/work/relay.txt',
        },
      ],
    },
  ],
};

/**
 * 9. The handover.
 *
 * What happened, when, and what was done -- written so the next person does
 * not have to find it the way this one did. Pell left two years of restarts
 * and no notes, which is the only thing on this floor anybody could fairly be
 * blamed for.
 *
 * It must not conclude anything about *why* the catalogue died, because the
 * player does not know and cannot find out: the journal only has today, and
 * the lock is the single surviving record of the first of July. An operator
 * writes down what the system did. Speculation is somebody else's job and the
 * goal does not ask for any.
 */
const theHandover: Objective = {
  id: 'the-handover',
  title: 'Write down what happened, so the next person does not start where you did',
  teaches: ['journalctl', 'cat', 'shell redirection'],
  requires: ['after-the-reboot', 'the-second-lie', 'serve-the-matter'],
  done: (w) => {
    const text = written(w);
    return (
      /\bcatalogue\b/.test(text) &&
      // The date the datastore actually died, which survives only in the lock.
      /2398-07-01|07-01/.test(text) &&
      /enabl|start|restart/i.test(text)
    );
  },
  routes: [
    {
      name: 'the lock, the journal, and a line of your own',
      commands: [
        "ssh index01 'cat /var/lib/index/catalogue.lock' > ~/work/handover.txt",
        "ssh index01 'journalctl -u catalogue' >> ~/work/handover.txt",
        'echo "catalogue started and enabled; it was never enabled before" >> ~/work/handover.txt',
      ],
    },
    {
      name: 'written out by hand from what you found',
      commands: [
        'echo "catalogue died 2398-07-01T02:11, see the lock on index01" > ~/work/handover.txt',
        'echo "started it and enabled it so it comes back on its own" >> ~/work/handover.txt',
      ],
    },
    {
      name: 'everything, then the summary',
      commands: [
        "ssh index01 'cat /var/lib/index/catalogue.lock' > ~/work/handover.txt",
        "ssh index01 'systemctl list-units' >> ~/work/handover.txt",
        'echo "2398-07-01: catalogue stopped. Now restarted and enabled." >> ~/work/handover.txt',
      ],
    },
  ],
  nearMisses: [
    {
      name: 'the journal on its own',
      because:
        'It only has today. The catalogue died on the first of July and nothing in ' +
        'the journal remembers that, which is why the lock matters.',
      commands: ["ssh index01 'journalctl -u catalogue' > ~/work/handover.txt"],
    },
    {
      name: 'what you did, with no when',
      because:
        'A handover without the date tells the next person that something was done ' +
        'and not that a service was dead for two weeks.',
      commands: ['echo "started and enabled the catalogue" > ~/work/handover.txt'],
    },
    {
      name: 'the lock with nothing around it',
      because:
        'The lock is a timestamp and a pid. On its own it does not say what was ' +
        'wrong or what was done about it.',
      commands: ["ssh index01 'cat /var/lib/index/catalogue.lock' > ~/work/handover.txt"],
    },
  ],
  steps: [
    {
      id: 'when',
      label: 'find when it actually died',
      pending: (w) => !/2398-07-01|07-01/.test(written(w)),
      rungs: [
        {
          tier: 'nudge',
          lines: [
            'The journal starts this morning, because the floor came up this morning.',
            'Something older than that recorded the first of July.',
          ],
        },
        {
          tier: 'direction',
          lines: [
            'The catalogue left a lock behind when it went. It is still on index01',
            'under /var/lib/index, and it has the pid and the minute in it.',
          ],
        },
        {
          tier: 'command',
          lines: ['Read it into your notes:'],
          command: "ssh index01 'cat /var/lib/index/catalogue.lock' > ~/work/handover.txt",
        },
      ],
    },
    {
      id: 'what',
      label: 'and what you did about it',
      pending: (w) => {
        const text = written(w);
        return !(/\bcatalogue\b/.test(text) && /enabl|start|restart/i.test(text));
      },
      rungs: [
        {
          tier: 'nudge',
          lines: ['Pell left two years of restarts and no notes. That is the one thing to fix.'],
        },
        {
          tier: 'direction',
          lines: [
            'What was down, when it went, and what you changed. Not why it died --',
            'you do not know that, and writing a guess into a record is how a guess',
            'becomes a fact.',
          ],
        },
        {
          tier: 'command',
          lines: ['Add the part only you know:'],
          command:
            'echo "catalogue started and enabled; it was never enabled before" >> ~/work/handover.txt',
        },
      ],
    },
  ],
};

/**
 * A. Clean hands. Optional, and the best thing in the act.
 *
 * His own matter is on vault01. He knows the number from his own post -- the
 * notice Tessaly sent him, which is on the bastion and was there before this
 * job was -- and he could read the file in two seconds, because he has root
 * on the machine that holds it.
 *
 * The goal is deliberately **not** "do not open it". A predicate that asserts
 * on what the player did not do is a predicate reading the input, which this
 * engine does not do, and it would also be unplayable: nothing would ever tell
 * them they had passed.
 *
 * So it asks for the demonstration instead. Produce, from the store's own
 * record, the fact that every file under your matter was read by the
 * tribunal's account -- and have that record still show no read by yours. The
 * first half is technical work. The second half is not work at all; it is the
 * thing he did by not doing anything, and the only reason it can be checked is
 * that the store writes the log rather than the operator.
 *
 * Three things the predicate is careful about, each for a reason:
 *
 *   - It reads the record off vault01, not out of his notes. A copy proves
 *     nothing, because a copy can be edited.
 *   - It requires the record to *still* contain the tribunal's reads, so
 *     deleting the log is a way to fail this objective rather than a way to
 *     pass it.
 *   - It asks for both files. The tribunal read the manifest and then the
 *     disclosure a minute later, and "every file under his matter" is the
 *     claim he is making.
 *
 * A player who already opened it cannot complete this, ever, and that is the
 * design and not an oversight: the store wrote the line and nothing takes it
 * out. The last step's ladder is the only place the game can say so, and it
 * says it without scolding. See the note on that step.
 */
const cleanHands: Objective = {
  id: 'clean-hands',
  title: 'Show, from the record, who has read your own matter',
  teaches: ['grep', 'scp', 'an access record'],
  optional: true,
  secret: true,
  requires: ['serve-the-matter'],
  done: (w) => {
    const notes = written(w);
    const record = accessRecord(w);
    return (
      // The record still says what it said, on the machine that keeps it.
      readBy('tribunal').test(record) &&
      // Both files, produced where somebody else could read them.
      new RegExp(`tribunal\\s+${HIS_MATTER}/manifest`).test(notes) &&
      new RegExp(`tribunal\\s+${HIS_MATTER}/disclosure\\.txt`).test(notes) &&
      // And his own account is not in it.
      !readBy('dewitt').test(record)
    );
  },
  routes: [
    {
      name: 'your own post, then the record',
      commands: [
        'cat ~/NOTICE',
        `ssh vault01 'grep ${HIS_MATTER} ${ACCESS_LOG}' > ~/work/mine.txt`,
      ],
    },
    {
      name: 'the whole record, copied back',
      commands: ['cat ~/NOTICE', `scp vault01:${ACCESS_LOG} ~/work/access.log`],
    },
    {
      name: 'read it over there and filter it here',
      commands: [
        'cat ~/NOTICE',
        `ssh vault01 'cat ${ACCESS_LOG}' | grep ${HIS_MATTER} > ~/work/mine.txt`,
      ],
    },
  ],
  nearMisses: [
    {
      name: 'looking at it yourself',
      because:
        'The store served it and wrote a line with your account on it, which is ' +
        'what the store is for. Nothing you write afterwards changes what the ' +
        'record says, and this objective is the record.',
      commands: [`ssh vault01 'deposit get ${HIS_MATTER}/manifest' > ~/work/mine.txt`],
    },
    {
      name: 'saying it instead of showing it',
      because:
        'An operator vouching for himself is the one piece of evidence nobody has ' +
        'any reason to accept. The record is on vault01 and it is readable.',
      commands: ['echo "the tribunal read my matter and I did not" > ~/work/mine.txt'],
    },
    {
      name: 'the file you thought of',
      because:
        'The manifest is not the whole matter. The tribunal read the disclosure a ' +
        'minute later, and the claim is about every file under your number.',
      commands: [
        `ssh vault01 'grep ${HIS_MATTER}/manifest ${ACCESS_LOG}' > ~/work/mine.txt`,
      ],
    },
  ],
  steps: [
    {
      id: 'which-one',
      label: 'work out which matter is yours',
      pending: (w) => !new RegExp(HIS_MATTER).test(written(w)),
      rungs: [
        {
          tier: 'nudge',
          lines: [
            'Pell said some of what is on vault01 is yours. You do not have to go',
            'looking on vault01 to find out which -- you were told, months ago, by',
            'the people contesting it.',
          ],
        },
        {
          tier: 'direction',
          lines: [
            'Your own post is in your home directory and it has the docket number',
            'in it. That is the one piece of this you are entitled to.',
          ],
        },
        {
          tier: 'command',
          lines: ['Read it, and keep the number where you are working:'],
          command: 'cat ~/NOTICE > ~/work/mine.txt',
        },
      ],
    },
    {
      id: 'the-record',
      label: 'and who the record says has read it',
      pending: (w) => {
        const notes = written(w);
        return !(
          new RegExp(`tribunal\\s+${HIS_MATTER}/manifest`).test(notes) &&
          new RegExp(`tribunal\\s+${HIS_MATTER}/disclosure\\.txt`).test(notes)
        );
      },
      rungs: [
        {
          tier: 'nudge',
          lines: [
            'The store writes down every read it serves. That log is on vault01 and',
            'it is readable by you -- reading the record is not reading the file.',
          ],
        },
        {
          tier: 'direction',
          lines: [
            `${ACCESS_LOG} has a line per read: the minute, the account, and the`,
            'file. grep for your number and you have every line that concerns it.',
          ],
        },
        {
          tier: 'command',
          lines: ['Both lines, where you can hand them over:'],
          command: `ssh vault01 'grep ${HIS_MATTER} ${ACCESS_LOG}' >> ~/work/mine.txt`,
        },
      ],
    },
    /*
     * The step that cannot be cleared, and is the point.
     *
     * It is pending only in a world where the store has already recorded him
     * reading his own matter -- and in that world nothing clears it, because
     * the record is correct and stays correct. Every other step in this
     * adventure is a thing to do; this one is a thing to be told.
     *
     * Its bottom rung therefore does not fix anything, and it is not pretending
     * to: it shows him the line. `deposit.test.ts` has a test asserting exactly
     * this -- that once his account is in the record the objective cannot be
     * completed -- so the exception is written down and checked rather than
     * discovered by somebody wondering why the hint does nothing.
     */
    {
      id: 'and-not-you',
      label: 'which cannot now include you',
      pending: (w) => readBy('dewitt').test(accessRecord(w)),
      rungs: [
        {
          tier: 'nudge',
          lines: [
            'The record has your account against your own matter. That is not a',
            'thing you can be talked out of and it is not a thing you can clear.',
          ],
        },
        {
          tier: 'direction',
          lines: [
            'There is no repair for this one. The store wrote the line, which is',
            'why anybody would have believed the record if it had been empty.',
            'Leave it where it is.',
          ],
        },
        {
          tier: 'command',
          lines: ['It is one line. It is worth reading once:'],
          command: `ssh vault01 'grep dewitt ${ACCESS_LOG}'`,
        },
      ],
    },
  ],
  onComplete: [
    '',
    'LUNA: I read the record, Doc. The tribunal opened your matter twice on',
    'LUNA: the second of July, a minute apart, and your account has never',
    'LUNA: opened it at all.',
    '',
    'LUNA: You had root on that machine the whole time.',
    '',
    'LUNA: I am not going to make a speech about it. I am going to note that',
    'LUNA: the record is the only reason anyone can tell, and that you are the',
    'LUNA: one who kept the record working.',
    '',
  ],
};

/**
 * B. Where she cannot go. Optional.
 *
 * She goes quiet the moment he ssh-es anywhere that matters, and a player who
 * notices will assume something is broken -- an assistant that stops working
 * on three of four machines looks exactly like a bug.
 *
 * It is not a bug and it is not manners. It is two files: an allowlist on the
 * bastion saying which hosts she may run on, and the office policy on the
 * deposit hosts saying why. The objective is reading both, which means going
 * to a machine she cannot follow him to in order to find out why she cannot
 * follow him there.
 *
 * The lesson is the one every operations job teaches in week one: the tooling
 * you depend on is not installed on the box you are paged about. It never is.
 */
const whereSheCannotGo: Objective = {
  id: 'where-she-cannot-go',
  title: 'Find out why LUNA goes quiet when you leave the bastion',
  teaches: ['cat', 'grep', 'host allowlists'],
  optional: true,
  secret: true,
  requires: ['the-floor'],
  done: (w) => {
    const notes = written(w);
    // Her side of the boundary, and the office's reason for it. Either alone
    // is half an answer: a rule with no reason, or a reason with no rule.
    return /deny\s+vault01/.test(notes) && /runs only software the office/i.test(notes);
  },
  routes: [
    {
      name: 'her scope, then their policy',
      commands: [
        'cat /etc/luna/scope > ~/work/boundary.txt',
        "ssh vault01 'cat /etc/deposit/policy' >> ~/work/boundary.txt",
      ],
    },
    {
      name: 'the policy first, from whichever host you are on',
      commands: [
        "ssh index01 'cat /etc/deposit/policy' > ~/work/why.txt",
        'grep deny /etc/luna/scope >> ~/work/why.txt',
      ],
    },
    {
      name: 'both files themselves',
      commands: [
        'scp relay01:/etc/deposit/policy ~/work/policy',
        'cp /etc/luna/scope ~/work/scope',
      ],
    },
  ],
  nearMisses: [
    {
      name: 'the rule with no reason',
      because:
        'The allowlist says where she may not run. It does not say why, and "the ' +
        'config says so" is the answer that stops people asking whether a policy ' +
        'is still the right one.',
      commands: ['cp /etc/luna/scope ~/work/boundary.txt'],
    },
    {
      name: 'the reason with no rule',
      because:
        'The policy explains the boundary without establishing where it runs. Four ' +
        'hosts, and the one you are typing at is on the other side of it.',
      commands: ["ssh vault01 'cat /etc/deposit/policy' > ~/work/boundary.txt"],
    },
    {
      name: 'what you assumed',
      because:
        'It happens to be true, and it is what anybody would guess before looking. ' +
        'A boundary you assumed is a boundary you cannot tell from a fault, which ' +
        'is the whole reason to go and read it.',
      commands: ['echo "luna is not allowed on the deposit hosts" > ~/work/boundary.txt'],
    },
  ],
  steps: [
    {
      id: 'her-scope',
      label: 'find where she is allowed to run',
      pending: (w) => !/deny\s+vault01/.test(written(w)),
      rungs: [
        {
          tier: 'nudge',
          lines: [
            'She is quiet on three machines and talking on this one. Something on',
            'this one decides that, and it is configuration rather than character.',
          ],
        },
        {
          tier: 'direction',
          lines: [
            'She runs as a service here, like everything else does. Services keep',
            'their configuration under /etc, in a directory named after them.',
          ],
        },
        {
          tier: 'command',
          lines: ['Her allowlist:'],
          command: 'cat /etc/luna/scope > ~/work/boundary.txt',
        },
      ],
    },
    {
      id: 'their-policy',
      label: 'and why the office wrote it that way',
      pending: (w) => !/runs only software the office/i.test(written(w)),
      rungs: [
        {
          tier: 'nudge',
          lines: [
            'The allowlist names a policy and does not contain it. The policy is',
            'kept on the machines it applies to.',
          ],
        },
        {
          tier: 'direction',
          lines: [
            'Each deposit host has /etc/deposit/policy. You will have to go to one',
            'of them to read it, which is the thing she cannot do.',
          ],
        },
        {
          tier: 'command',
          lines: ['Add the reason to the rule:'],
          command: "ssh vault01 'cat /etc/deposit/policy' >> ~/work/boundary.txt",
        },
      ],
    },
  ],
  onComplete: [
    '',
    'LUNA: I can hear you typing and I cannot see what you are typing at.',
    '',
    'LUNA: I would like you to know that I do not like it, and that the policy',
    'LUNA: is right. A machine that holds evidence should not run anything the',
    'LUNA: office did not install, and I am something somebody did not install.',
    '',
    'LUNA: Do not carry me across it. Tell me what you found when you get back.',
    '',
  ],
};

export const DEPOSIT_OBJECTIVES: Objective[] = [
  theFloor,
  theCheckThatLied,
  whyItWillNotStart,
  shipIt,
  notADnsProblem,
  afterTheReboot,
  serveTheMatter,
  theSecondLie,
  theHandover,
  cleanHands,
  whereSheCannotGo,
];
