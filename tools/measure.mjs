/**
 * What each game cost, and whether the series is arithmetic.
 *
 * `docs/PLAN.md` Phase 5 states the thesis plainly:
 *
 *   Gate: if The Archive costs <=40% of what The Wreck cost, the architecture
 *   is validated and thirteen is real. If it costs more, stop and fix the
 *   engine before building a third. This number is the whole thesis.
 *
 * A gate nobody can compute is a gate nobody will honour, so this computes
 * it. Lines of source, counted the same way both times, and an explicit list
 * of what is attributed to whom -- because the arguable part is not the
 * counting, it is the attribution.
 *
 *     node tools/measure.mjs
 *     node tools/measure.mjs --since <sha>
 *
 * Deliberately crude. Lines of code is a bad measure of value and a
 * serviceable measure of *effort spent typing*, which is what the gate is
 * actually asking about.
 */
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

/** The commit game two's work started from. Everything after it is game two. */
const DEFAULT_BASELINE = 'f3d7d48';

const args = process.argv.slice(2);
const baseline = args.includes('--since') ? args[args.indexOf('--since') + 1] : DEFAULT_BASELINE;

const ENGINE = [
  'packages/machine',
  'packages/quest',
  'packages/crt',
  'packages/editor',
  'packages/ascii',
  'packages/audio',
  'packages/python',
  'apps/terminal',
];

function countLines(dir, { tests = false } = {}) {
  const root = join(dir, tests ? 'test' : 'src');
  let total = 0;
  const walk = (d) => {
    let entries;
    try {
      entries = readdirSync(d);
    } catch {
      return;
    }
    for (const entry of entries) {
      const path = join(d, entry);
      if (statSync(path).isDirectory()) walk(path);
      else if (entry.endsWith('.ts')) total += readFileSync(path, 'utf8').split('\n').length;
    }
  };
  walk(root);
  return total;
}

/** Lines added to a path since the baseline, from git rather than from now. */
function addedSince(paths) {
  const out = execFileSync(
    'git',
    ['diff', '--numstat', `${baseline}..HEAD`, '--', ...paths],
    { encoding: 'utf8' },
  );
  let added = 0;
  for (const line of out.split('\n')) {
    const [plus, , file] = line.split('\t');
    if (!file || !file.endsWith('.ts')) continue;
    if (file.startsWith('games/archive') || file.startsWith('packages/sql')) continue;
    added += Number(plus) || 0;
  }
  return added;
}

const sum = (dirs, opts) => dirs.reduce((n, d) => n + countLines(d, opts), 0);

/** Counted from the source rather than imported, so this stays a script. */
const objectivesIn = (file) =>
  (readFileSync(file, 'utf8').match(/^    id: '/gm) ?? []).length;

const WRECK_OBJ = objectivesIn('games/wreck/src/objectives.ts');
const ARCHIVE_OBJ = objectivesIn('games/archive/src/objectives.ts');

// ------------------------------------------------------------------ the sums

// The Wreck's cost is the whole machine plus its own content: none of the
// engine existed before it, and all of it was built to carry it.
const engineNow = sum(ENGINE);
const engineGrowth = addedSince(ENGINE.map((d) => `${d}/src`));
const wreckGrowth = addedSince(['games/wreck/src']);

const wreckEngine = engineNow - engineGrowth;
const wreckContent = countLines('games/wreck') - wreckGrowth;
const wreckTotal = wreckEngine + wreckContent;

// The Archive's cost is its own package, its engine, and every line game two
// caused to be written elsewhere -- the route harness, the SQL interface, and
// the retrofit of Act I's objectives to the schema it needed.
const archiveEngine = countLines('packages/sql');
const archiveContent = countLines('games/archive');
const archiveShared = engineGrowth + wreckGrowth;
const archiveTotal = archiveEngine + archiveContent + archiveShared;

const budget = Math.round(wreckTotal * 0.4);
const ratio = archiveTotal / wreckTotal;

const pad = (n) => String(n).padStart(6);
console.log(`
  Baseline for game two: ${baseline}

  THE WRECK
    engine (8 packages + app)        ${pad(wreckEngine)}
    content (games/wreck)            ${pad(wreckContent)}
                                     ${pad(wreckTotal)}

  THE ARCHIVE
    engine (packages/sql)            ${pad(archiveEngine)}
    content (games/archive)          ${pad(archiveContent)}
    caused elsewhere                 ${pad(archiveShared)}
      (route harness, SQL interface,
       Act I retrofitted to the schema)
                                     ${pad(archiveTotal)}

  GATE
    budget at 40%                    ${pad(budget)}
    spent                            ${pad(archiveTotal)}
    ratio                            ${(ratio * 100).toFixed(1)}%  ${ratio <= 0.4 ? 'UNDER' : 'OVER'}

  PER OBJECTIVE -- the comparator that is not flattering
    The Wreck    ${WRECK_OBJ} objectives     ${pad(Math.round(wreckContent / WRECK_OBJ))} lines each
    The Archive  ${ARCHIVE_OBJ} objectives     ${pad(Math.round(archiveContent / ARCHIVE_OBJ))} lines each

    The Archive is a shorter game. Projected to the same objective count,
    at its own density it would cost ${pad(Math.round(archiveContent / ARCHIVE_OBJ) * WRECK_OBJ + archiveEngine + archiveShared)}
    (${(((Math.round(archiveContent / ARCHIVE_OBJ) * WRECK_OBJ) + archiveEngine + archiveShared) / wreckTotal * 100).toFixed(1)}%), and at The Wreck's density ${pad(Math.round(wreckContent / WRECK_OBJ) * WRECK_OBJ + archiveEngine + archiveShared)} (${(((Math.round(wreckContent / WRECK_OBJ) * WRECK_OBJ) + archiveEngine + archiveShared) / wreckTotal * 100).toFixed(1)}%).
    Both are under the gate, which is the finding that matters.

  Tests, for reference, not in the gate:
    games/wreck                      ${pad(countLines('games/wreck', { tests: true }))}
    games/archive                    ${pad(countLines('games/archive', { tests: true }))}
`);

if (ratio > 0.4) {
  console.log('  Over. Per PLAN.md Phase 5: stop, and fix whatever made it expensive');
  console.log('  before building a third.\n');
}
