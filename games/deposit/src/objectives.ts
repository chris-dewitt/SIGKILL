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

export const DEPOSIT_OBJECTIVES: Objective[] = [theFloor, theCheckThatLied, whyItWillNotStart];
