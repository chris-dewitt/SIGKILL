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
 * it. Lines of source, counted the same way every time, and an explicit list
 * of what is attributed to whom -- because the arguable part is not the
 * counting, it is the attribution.
 *
 *     node tools/measure.mjs
 *
 * Deliberately crude. Lines of code is a bad measure of value and a
 * serviceable measure of *effort spent typing*, which is what the gate is
 * actually asking about.
 *
 * Each game after the first is measured against the commit its work started
 * from: its own package, plus every line it caused to be written elsewhere.
 * "Caused elsewhere" is the number that matters and the one it is tempting to
 * leave out -- game two's real cost was mostly the route harness, and game
 * three's was mostly seven fixes to the Python bridge.
 *
 * Games four to six were missing from this for a while, which made the gate
 * something the repo talked about rather than something it computed. Their
 * windows are each the commit their first content landed on top of, the same
 * rule as games two and three.
 */
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

/*
 * The engine as it stood when The Wreck shipped -- game one's cost.
 *
 * `packages/sql` is deliberately absent. It is game two's own engine and is
 * counted in game two's row; listing it here as well charged its 507 lines to
 * both games at once and quietly moved the baseline every ratio is measured
 * against.
 */
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

/**
 * The games, in order, each with the commit its work started from.
 *
 * `own` is what belongs to that game and must not be counted as engine growth
 * caused by a later one.
 */
const GAMES = [
  { name: 'The Wreck', content: 'games/wreck', own: [], since: null },
  {
    name: 'The Archive',
    content: 'games/archive',
    own: ['games/archive', 'packages/sql'],
    since: 'f3d7d48',
    engine: ['packages/sql'],
  },
  {
    name: 'The Harness',
    content: 'games/harness',
    own: ['games/harness'],
    since: 'ddeb76b',
    engine: [],
  },
  {
    name: 'The Fork',
    content: 'games/fork',
    own: ['games/fork', 'packages/git'],
    since: '195fc05',
    engine: ['packages/git'],
  },
  {
    name: 'The Containment',
    content: 'games/containment',
    own: ['games/containment', 'packages/ml'],
    since: 'e5c790a',
    engine: ['packages/ml'],
  },
  {
    name: 'The Deposit',
    content: 'games/deposit',
    own: ['games/deposit'],
    /*
     * Where game six's work actually began: the network probe, three commits
     * before any of its own content. The probes, the `Requires=`/`After=` fix
     * and `snapshotFleet` are all its cost and all outside its package.
     */
    since: 'bbcb5ef',
    engine: [],
  },
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

/**
 * Lines added to a path inside one game's window, from git rather than from now.
 *
 * The window ends where the next game's work began, and getting that wrong was
 * the first thing this script did: with every window running to HEAD, game
 * three's 2,849 lines of content were charged to game two as overhead and
 * subtracted from game one, which moved all three numbers at once.
 */
function addedBetween(from, to, paths, exclude = []) {
  const out = execFileSync('git', ['diff', '--numstat', `${from}..${to}`, '--', ...paths], {
    encoding: 'utf8',
  });
  let added = 0;
  for (const line of out.split('\n')) {
    const [plus, , file] = line.split('\t');
    if (!file || !file.endsWith('.ts')) continue;
    if (exclude.some((prefix) => file.startsWith(prefix))) continue;
    added += Number(plus) || 0;
  }
  return added;
}

const sum = (dirs, opts) => dirs.reduce((n, d) => n + countLines(d, opts), 0);

/** Counted from the source rather than imported, so this stays a script. */
/*
 * Objectives in a file, by the indent their `id` sits at.
 *
 * Two spaces or four: games one to five declare their objectives inside one
 * array literal, game six declares each as its own top-level const. Steps are
 * nested deeper than either and are not counted, which is the whole reason
 * this is indent-sensitive rather than a search for `id:`.
 */
const objectivesIn = (file) =>
  (readFileSync(file, 'utf8').match(/^ {2,4}id: '/gm) ?? []).length;

// ------------------------------------------------------------------ the sums

const srcOf = (dirs) => dirs.map((d) => `${d}/src`);

/*
 * Later games' growth, subtracted from game one.
 *
 * Everything in the engine today that a later game caused was not part of
 * building The Wreck, so counting it against The Wreck would flatter every
 * ratio below it.
 */
const windows = GAMES.filter((g) => g.since);
const laterGrowth = windows.map((game, i) => {
  const until = windows[i + 1]?.since ?? 'HEAD';
  return {
    game,
    engine: addedBetween(game.since, until, srcOf(ENGINE), game.own),
    content: addedBetween(game.since, until, srcOf(GAMES.map((g) => g.content)), game.own),
  };
});

const wreck = {
  name: 'The Wreck',
  engine: sum(ENGINE) - laterGrowth.reduce((n, g) => n + g.engine, 0),
  content: countLines('games/wreck') - laterGrowth.reduce((n, g) => n + g.content, 0),
  elsewhere: 0,
};
wreck.total = wreck.engine + wreck.content;

const rows = [wreck];
for (const { game, engine, content } of laterGrowth) {
  const row = {
    name: game.name,
    engine: sum(game.engine ?? []),
    content: countLines(game.content),
    elsewhere: engine + content,
  };
  row.total = row.engine + row.content + row.elsewhere;
  row.ratio = row.total / wreck.total;
  rows.push(row);
}

const pad = (n) => String(n).padStart(6);
const budget = Math.round(wreck.total * 0.4);

console.log(`
  THE WRECK -- the baseline everything is measured against
    engine (${ENGINE.length} packages + app)        ${pad(wreck.engine)}
    content (games/wreck)            ${pad(wreck.content)}
                                     ${pad(wreck.total)}
`);

for (const row of rows.slice(1)) {
  console.log(`  ${row.name.toUpperCase()}
    own engine package               ${pad(row.engine)}
    content                          ${pad(row.content)}
    caused elsewhere                 ${pad(row.elsewhere)}
                                     ${pad(row.total)}
    ratio                            ${(row.ratio * 100).toFixed(1)}%  ${
      row.ratio <= 0.4 ? 'UNDER' : 'OVER'
    } the 40% gate (${budget})
`);
}

console.log('  PER OBJECTIVE -- the comparator that is not flattering');
for (const game of GAMES) {
  const file = `${game.content}/src/objectives.ts`;
  const count = objectivesIn(file);
  const content = countLines(game.content);
  console.log(
    `    ${game.name.padEnd(15)} ${String(count).padStart(2)} objectives  ` +
      `${pad(Math.round(content / count))} lines each`,
  );
}

const wreckPer = Math.round(wreck.content / objectivesIn('games/wreck/src/objectives.ts'));
console.log(`
  Projected to The Wreck's nine objectives, at The Wreck's own density:`);
for (const row of rows.slice(1)) {
  const projected = wreckPer * 9 + row.engine + row.elsewhere;
  console.log(
    `    ${row.name.padEnd(15)} ${pad(projected)}  (${((projected / wreck.total) * 100).toFixed(1)}%)`,
  );
}

console.log(`
  Tests, for reference, not in the gate:`);
for (const game of GAMES) {
  console.log(`    ${game.name.padEnd(15)} ${pad(countLines(game.content, { tests: true }))}`);
}
console.log();

const over = rows.slice(1).filter((r) => r.ratio > 0.4);
if (over.length > 0) {
  console.log(`  Over: ${over.map((r) => r.name).join(', ')}.`);
  console.log('  Per PLAN.md Phase 5: stop, and fix whatever made it expensive');
  console.log('  before building the next one.\n');
}
