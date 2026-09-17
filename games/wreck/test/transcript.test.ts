/**
 * A real transcript of Act I, printed.
 *
 * Not a test -- a reading tool. Run it with:
 *
 *     pnpm --filter @sigkill/wreck exec vitest run transcript \
 *       --disable-console-intercept
 *
 * The flag is what stops vitest swallowing the output of a passing test.
 *
 * Every content bug so far was found by looking at output rather than
 * asserting on it: the stale status line, the silent success, the act that
 * could not be finished. This prints what a player would actually see.
 */
import { it } from 'vitest';
import { bootWreck, coldOpen, epilogue } from '../src/world.js';
import type { BeatLine } from '@sigkill/quest';

/** Beats as they read on screen; art rows pass through unchanged. */
const spoken = (lines: readonly BeatLine[]): string =>
  lines.map((line) => (typeof line === 'string' ? line : line.art)).join('\n');

const SCRIPT = [
  'objectives',
  'start systemctl',
  'ls',
  'cat README',
  'systemctl --failed',
  'pressure',
  'systemctl status scrubber',
  'cat /etc/life_support.conf',
  "sed -i 's/^O2_TARGET=.*/O2_TARGET=21/' /etc/life_support.conf",
  'sudo systemctl start scrubber',
  'sudo systemctl enable scrubber',
  'ls -l /home',
  'cat /home/vasquez/notes/todo',
  'systemctl status hull-monitor',
  'ls -l /usr/local/bin/hull-check',
  'cat /usr/local/bin/hull-check',
  './seal.sh c7',
  'sudo chmod +x /usr/local/bin/hull-check',
  'ls -l /usr/local/bin/hull-check',
  'sudo systemctl start hull-monitor',
  'sudo systemctl enable hull-monitor',
  'hull-check',
  'wc -l /var/log/hull.log',
  'grep -c PRESSURE_DROP /var/log/hull.log',
  "grep PRESSURE_DROP /var/log/hull.log | cut -d' ' -f2 | sort | uniq -c",
  'grep C2 /var/log/hull.log | grep DROP | tail -2',
  'grep C7 /var/log/hull.log | tail -2',
  'cat /etc/hull/c7.conf',
  'sudo chmod +x /home/vasquez/notes/seal.sh',
  'sudo /home/vasquez/notes/seal.sh c7',
  'systemctl list-units',
  'deck',
  'pressure',
  // Puzzle five: the process nobody started, and the signal it declines.
  'cat /home/vasquez/notes/purge-notes.txt',
  'ps -ef',
  'tail -4 /var/log/purge.log',
  'sudo pkill atmo-purge',
  'ps -ef | grep purge',
  'tail -2 /var/log/purge.log',
  'sudo pkill -9 atmo-purge',
  'ps -ef | grep purge',
  'deck',
  'pressure',
  'objectives',
  'date',
];

it('prints a transcript', async () => {
  const { machine, questbook } = bootWreck();
  // console rather than process.stdout: this package has no node types, and
  // vitest prints console output with the test it came from either way.
  const lines: string[] = [];
  const say = (text: string): void => { lines.push(text); };

  say(spoken(coldOpen(machine)) + '\n');

  for (const command of SCRIPT) {
    say(`\nsurvivor@nav7:${machine.shell.cwd}$ ${command}\n`);
    const r = await machine.exec(command);
    if (r.stdout) say(r.stdout);
    if (r.stderr) say(`[stderr] ${r.stderr}`);
    for (const objective of questbook.drainCompleted(machine)) {
      say(spoken(objective.onComplete ?? []) + '\n');
    }
  }

  if (questbook.complete(machine)) say('\n' + spoken(epilogue(machine)) + '\n');
  else say('\n!!! ACT NOT COMPLETE: ' +
    JSON.stringify(questbook.status(machine).filter((o) => !o.done).map((o) => o.id)) + '\n');

  console.log(lines.join(''));
});
