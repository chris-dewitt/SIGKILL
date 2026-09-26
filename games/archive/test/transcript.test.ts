/**
 * A real transcript of The Archive, printed.
 *
 * Not a test -- a reading tool, the same shape as the one in `games/wreck`.
 * Run it with:
 *
 *     pnpm --filter @sigkill/archive exec vitest run transcript \
 *       --disable-console-intercept
 *
 * Five of the nine engine bugs in Act I were found by reading one of these
 * and none of them by a unit test.
 */
import { it } from 'vitest';
import { NodeSqlRuntime } from '@sigkill/sql/node';
import type { BeatLine } from '@sigkill/quest';
import { bootArchive, coldOpen, epilogue } from '../src/world.js';
import { CLAIMS_DB, EVIDENCE_DB } from '../src/index.js';

const spoken = (lines: readonly BeatLine[]): string =>
  lines.map((line) => (typeof line === 'string' ? line : line.art)).join('\n');

const SCRIPT = [
  'objectives',
  'ls',
  'cat README',
  'cat tow-invoice.txt',
  'ls carried',
  'cat /etc/motd',
  // The archive, opened for the first time.
  `sqlite3 ${CLAIMS_DB} .tables`,
  'cat /srv/archive/schema.sql',
  `sqlite3 ${CLAIMS_DB} "SELECT * FROM vessels;"`,
  `sqlite3 ${CLAIMS_DB} "SELECT clause, survivors FROM claims WHERE vessel_id = 1140;" > findings.txt`,
  'cat findings.txt',
  // Who was aboard.
  `sqlite3 ${CLAIMS_DB} ".schema crew"`,
  `sqlite3 ${CLAIMS_DB} "SELECT c.name, x.number FROM crew c JOIN certifications x ON x.crew_id = c.id WHERE c.vessel_id = 1140;" > crew.txt`,
  'cat crew.txt',
  // And the hole.
  `sqlite3 ${CLAIMS_DB} "SELECT c.name, x.number FROM crew c LEFT JOIN certifications x ON x.crew_id = c.id WHERE c.vessel_id = 1140;" > gap.txt`,
  `sqlite3 ${CLAIMS_DB} "SELECT * FROM filings WHERE subject = 'dewitt';" >> gap.txt`,
  'cat gap.txt',
  // Filing it.
  'cat /srv/archive/intake/README',
  `sqlite3 ${EVIDENCE_DB} "CREATE TABLE evidence (id INTEGER PRIMARY KEY, subject TEXT NOT NULL, source TEXT NOT NULL, detail TEXT NOT NULL); INSERT INTO evidence (subject,source,detail) VALUES ('dewitt','filings 4402','draft certification'),('dewitt','crew 5','apprentice aboard'),('NAV-7','carried','declared unmanned');"`,
  `sqlite3 -header ${EVIDENCE_DB} "SELECT * FROM evidence;"`,
  'ls -l /srv/archive/intake',
  // The line item.
  `sqlite3 ${CLAIMS_DB} "SELECT * FROM transits;"`,
  `sqlite3 ${CLAIMS_DB} "SELECT at, bytes, account, bound_for FROM transits ORDER BY bytes DESC LIMIT 1;" > transit.txt`,
  `sqlite3 ${CLAIMS_DB} "SELECT * FROM accounts WHERE code = 'RG-NAV7-03';"`,
  'cat /home/pell/correspondence.txt',
  'objectives',
  'date',
];

it('prints a transcript', async () => {
  const { machine, questbook } = await bootArchive({ sql: new NodeSqlRuntime() });
  const lines: string[] = [];
  const say = (text: string): void => { lines.push(text); };

  say(spoken(coldOpen()) + '\n');

  for (const command of SCRIPT) {
    say(`\ndewitt@ferryman:${machine.shell.cwd}$ ${command}\n`);
    const r = await machine.exec(command);
    machine.tick(1000);
    if (r.stdout) say(r.stdout);
    if (r.stderr) say(`[stderr] ${r.stderr}`);
    for (const objective of questbook.drainCompleted(machine)) {
      say(spoken(questbook.beat(objective, machine)) + '\n');
    }
  }

  if (questbook.complete(machine)) say('\n' + spoken(epilogue()) + '\n');
  else say('\n!!! NOT COMPLETE: ' +
    JSON.stringify(questbook.status(machine).filter((o) => !o.done).map((o) => o.id)) + '\n');

  console.log(lines.join(''));
}, 120_000);
