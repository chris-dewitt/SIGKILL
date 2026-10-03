import { Machine, ROOT_USER, type CommandSpec, type MachineSnapshot } from '@sigkill/machine';
import { editorCommands } from '@sigkill/editor';
import { Questbook, questCommands, withCompanion, type AdventureSnapshot, type Objective, type World } from '@sigkill/quest';

export const INTAKE = '/srv/intake';
export const WORK = '/home/dewitt/work';
export const RAW = 'E1,09:00,NAV-7,2,v1\nE2,09:05,TUG-9,3,v1\nE1,09:00,NAV-7,2,v1\nE3,09:10,NAV-7,broken,v1\n';
export const SECOND = 'E2,09:05,TUG-9,3,v2,confirmed\nE4,09:20,NAV-7,1,v2,confirmed\n';
export const LATE = 'E5,08:55,TUG-9,4,v2,late\n';
export const VALID_PATTERN = '^E[0-9]+,[0-9:]+,[A-Z0-9-]+,[0-9]+,v[12](,.*)?$';
export const EXPECTED = ['E1,09:00,NAV-7,2', 'E2,09:05,TUG-9,3', 'E4,09:20,NAV-7,1'];
export const ALL = [...EXPECTED, 'E5,08:55,TUG-9,4'];
const AUDIT = '/var/lib/pipeline/rehearsal.json';
const quote = (s: string) => `'${s.replaceAll("'", "'\\''")}'`;
export function read(w: World, path: string): string {
  try { return w.vfs.readText(path, ROOT_USER); } catch { return ''; }
}
const rows = (text: string) => text.trim().split('\n').filter(Boolean).sort();
const same = (a: string, b: readonly string[]) => JSON.stringify(rows(a)) === JSON.stringify([...b].sort());
const path = (name: string) => `${WORK}/${name}`;

/** A rehearsal records tested output and the exact recipe it tested. */
function verified(w: World, stage: 'replay' | 'late'): boolean {
  try {
    const audit = JSON.parse(read(w, AUDIT)) as { script: string; source: string; replay: boolean; late: boolean };
    return audit[stage] === true && read(w, audit.script) === audit.source && audit.source.length > 0;
  } catch { return false; }
}

function commands(book: Questbook): CommandSpec[] {
  return [...questCommands(book, { speaker: 'LUNA' }), ...editorCommands(), {
    name: 'rehearse', summary: 'test an intake recipe against replay and late-arrival fixtures',
    manual: 'rehearse /absolute/path/to/recipe\n\nRuns your executable shell recipe on isolated copies of this machine. The recipe reads /srv/intake/*.csv and prints canonical event rows to stdout. Checks normal input, duplicate delivery, and a late event. The live intake is unchanged. Results bind to the exact recipe tested.',
    plain: 'A safe test bench. Write a shell script that reads the intake files and prints id,time,claim,units once per event. chmod +x it, then rehearse its full path. This uses separate copies of the disk.',
    run: async (ctx, argv, io) => {
      const script = argv[1];
      if (!script?.startsWith('/') || argv.length !== 2) { io.err('rehearse: use an absolute recipe path\n'); return 2; }
      let source: string;
      try { source = ctx.vfs.readText(script, ctx.user); } catch { io.err('rehearse: cannot read that recipe\n'); return 1; }
      // No fixture can invoke this command recursively: clones have only coreutils.
      const snapshot = ctx.vfs.snapshot();
      const checks: boolean[] = [];
      const fixtures: Array<{ name: string; files: Record<string, string>; expected: readonly string[] }> = [
        { name: 'normal', files: { '001.csv': RAW, '002.csv': SECOND }, expected: EXPECTED },
        { name: 'replay', files: { '001.csv': RAW, '002.csv': SECOND, '003.csv': RAW + SECOND }, expected: EXPECTED },
        { name: 'late', files: { '001.csv': RAW, '002.csv': SECOND, '004.csv': LATE }, expected: ALL },
      ];
      for (const fixture of fixtures) {
        const clone = new Machine({ snapshot, user: ctx.user, cwd: '/home/dewitt', epoch: ctx.epoch });
        // Remove files inherited from a previous live delivery before seeding the test.
        for (const name of clone.vfs.readdir(INTAKE, ROOT_USER)) clone.vfs.unlink(`${INTAKE}/${name}`, ROOT_USER);
        for (const [name, data] of Object.entries(fixture.files)) clone.vfs.writeText(`${INTAKE}/${name}`, data, ROOT_USER);
        const result = await clone.exec(quote(script));
        const passed = result.code === 0 && result.stderr.length === 0 && same(result.stdout, fixture.expected);
        checks.push(passed);
        io.out(`${fixture.name}: ${passed ? 'PASS' : 'FAIL — expected unique id,time,claim,units rows'}\n`);
        if (result.stderr) io.out(result.stderr);
      }
      ctx.vfs.mkdirp('/var/lib/pipeline', ROOT_USER);
      ctx.vfs.writeText(AUDIT, JSON.stringify({ script, source, replay: checks[0] && checks[1], late: checks[0] && checks[2] }), ROOT_USER);
      ctx.vfs.chmod(AUDIT, 0o444, ROOT_USER);
      return checks.every(Boolean) ? 0 : 1;
    },
  }, {
    name: 'delivery', summary: 'receive the late intake batch',
    manual: 'delivery\n\nReceives batch 004 into /srv/intake. Repeating this replaces the same delivery file; event time is earlier than its arrival. Authored offline fixture.',
    plain: 'The late batch has arrived. delivery puts it beside the others. Your recipe must include it even though its event happened earlier.',
    run: (ctx, _argv, io) => {
      ctx.vfs.writeText(`${INTAKE}/004.csv`, LATE, ROOT_USER);
      io.out('MERRICK: Found this under the failed scanner. Eight fifty-five. It arrived after lunch.\n');
      return 0;
    },
  }];
}

const valid = `grep -E '${VALID_PATTERN}' ${INTAKE}/001.csv`;
const clean = `cat ${INTAKE}/*.csv | grep -E '${VALID_PATTERN}' | cut -d , -f 1,2,3,4`;
export const RECIPE = `#!/bin/sh\n${clean} | sort -u\n`;
const makeRecipe = (body = RECIPE) => `echo ${quote(body)} > /home/dewitt/pipe.sh; chmod +x /home/dewitt/pipe.sh`;
interface Spec { id: string; title: string; teaches: string[]; done: (w: World) => boolean; routes: string[][]; misses: string[][]; hint: string; beat: string[] }
function objective(spec: Spec, requires: string[]): Objective {
  return {
    id: spec.id, title: spec.title, teaches: spec.teaches, requires, done: spec.done,
    routes: spec.routes.map((commands, i) => ({ name: ['direct tools', 'stream through a pipe', 'alternate composition'][i]!, commands })),
    nearMisses: spec.misses.map((commands, i) => ({ name: ['incomplete output', 'plausible but wrong'][i]!, commands, because: 'The required data or tested behavior is absent.' })),
    steps: [{ id: 'produce', label: spec.title, pending: w => !spec.done(w), rungs: [
      { tier: 'nudge', lines: [spec.hint] },
      { tier: 'direction', lines: ['cat ~/README lists each file contract. Preserve the source, and compare what your next stage produces.'] },
      { tier: 'command', lines: ['One working route:'], command: spec.routes[0]!.join('; ') },
    ] }],
    onComplete: spec.beat,
  };
}
const specs: Spec[] = [
  { id: 'keep-the-source', title: 'Keep an untouched copy of the first batch', teaches: ['cp', 'cat', 'tee'],
    done: w => read(w, path('raw.csv')) === RAW,
    routes: [[`cp ${INTAKE}/001.csv ${path('raw.csv')}`], [`cat ${INTAKE}/001.csv > ${path('raw.csv')}`], [`cat ${INTAKE}/001.csv | tee ${path('raw.csv')}`]],
    misses: [[`head -n 1 ${INTAKE}/001.csv > ${path('raw.csv')}`], [`sort -u ${INTAKE}/001.csv > ${path('raw.csv')}`]],
    hint: 'Before fixing a delivery, keep what actually arrived. Even the repetition matters.',
    beat: ['MERRICK: Original kept. Now we can disagree with the cleaning without losing the evidence.'] },
  { id: 'quarantine', title: 'Separate valid rows and keep the rejected row', teaches: ['grep', 'shell redirection'],
    done: w => same(read(w, path('valid.csv')), RAW.trim().split('\n').filter(l => !l.includes('broken'))) && read(w, path('rejects.csv')).trim() === 'E3,09:10,NAV-7,broken,v1',
    routes: [[`${valid} > ${path('valid.csv')}`, `grep -E -v '${VALID_PATTERN}' ${INTAKE}/001.csv > ${path('rejects.csv')}`],
      [`cat ${INTAKE}/001.csv | grep -E '${VALID_PATTERN}' > ${path('valid.csv')}`, `cat ${INTAKE}/001.csv | grep -E -v '${VALID_PATTERN}' > ${path('rejects.csv')}`],
      [`sed '/broken/d' ${INTAKE}/001.csv > ${path('valid.csv')}`, `grep broken ${INTAKE}/001.csv | tee ${path('rejects.csv')}`]],
    misses: [[`${valid} > ${path('valid.csv')}`], [`cp ${INTAKE}/001.csv ${path('valid.csv')}`, `echo discarded > ${path('rejects.csv')}`]],
    hint: 'A unit count must be a number. Keep the row you cannot use; do not silently invent one.',
    beat: ['LUNA: E3 has no usable quantity. We kept it for someone to correct.', 'MERRICK: Thank you. Last week the totals were perfect because half the queue disappeared.'] },
  { id: 'one-schema', title: 'Normalize both batch formats into four columns', teaches: ['cut', 'grep', 'shell pipelines'],
    done: w => same(read(w, path('normalized.csv')), [...EXPECTED.slice(0,2), EXPECTED[0]!, EXPECTED[1]!, EXPECTED[2]!]),
    routes: [[`${clean} > ${path('normalized.csv')}`], [`${clean} | tee ${path('normalized.csv')}`], [`${clean} > /tmp/normalized; cp /tmp/normalized ${path('normalized.csv')}`]],
    misses: [[`cat ${INTAKE}/*.csv > ${path('normalized.csv')}`], [`${valid} | cut -d , -f 1,2,3,4 > ${path('normalized.csv')}`]],
    hint: 'Version two added a status field. The first four columns still mean id,time,claim,units.',
    beat: ['LUNA: Same contract from both scanners. Version numbers can disagree without changing the delivery.'] },
  { id: 'one-event', title: 'Keep each event once, including nonadjacent repeats', teaches: ['sort', 'uniq'],
    done: w => same(read(w, path('events.csv')), EXPECTED),
    routes: [[`${clean} | sort -u > ${path('events.csv')}`], [`${clean} | sort | uniq > ${path('events.csv')}`], [`${clean} | sort -r | uniq | tee ${path('events.csv')}`]],
    misses: [[`${clean} | uniq > ${path('events.csv')}`], [`${clean} | sort > ${path('events.csv')}`]],
    hint: 'The same id is the same delivery. Sort before uniq; it only compares neighbors. These fixtures have identical payloads for each repeated id.',
    beat: ['MERRICK: Three events. Five valid delivery records.', 'LUNA: Retries were charging people twice. Very reliable duplication.'] },
  { id: 'safe-to-repeat', title: 'Write a recipe that survives repeated delivery', teaches: ['chmod', 'rehearse', 'idempotent processing'],
    done: w => verified(w, 'replay'),
    routes: [[makeRecipe(), 'rehearse /home/dewitt/pipe.sh'], [makeRecipe(RECIPE.replace('sort -u','sort | uniq')), 'rehearse /home/dewitt/pipe.sh'], [makeRecipe(RECIPE.replace('sort -u','sort -r | uniq')), 'rehearse /home/dewitt/pipe.sh']],
    misses: [[makeRecipe(RECIPE.replace('sort -u','sort')), 'rehearse /home/dewitt/pipe.sh'], [makeRecipe(RECIPE.replace('/srv/intake/*.csv','/srv/intake/001.csv')), 'rehearse /home/dewitt/pipe.sh']],
    hint: 'Put the pipeline in an executable shell file. rehearse sends a duplicate delivery on a separate copy of the machine.',
    beat: ['LUNA: Same events after a retry. That is what idempotent buys us: permission to try again.'] },
  { id: 'late-is-not-lost', title: 'Include the late batch without duplicating earlier events', teaches: ['delivery', 'rehearse', 'late arriving data'],
    done: w => verified(w, 'late') && same(read(w, path('backfill.csv')), ALL),
    routes: [[makeRecipe(), 'rehearse /home/dewitt/pipe.sh', 'delivery', `/home/dewitt/pipe.sh > ${path('backfill.csv')}`], [makeRecipe(RECIPE.replace('sort -u','sort | uniq')), 'rehearse /home/dewitt/pipe.sh', 'delivery', `/home/dewitt/pipe.sh | tee ${path('backfill.csv')}`], [makeRecipe(RECIPE.replace('sort -u','sort -r | uniq')), 'rehearse /home/dewitt/pipe.sh', 'delivery', `/home/dewitt/pipe.sh > /tmp/backfill; cp /tmp/backfill ${path('backfill.csv')}`]],
    misses: [[`cp ${path('events.csv')} ${path('backfill.csv')}`], [makeRecipe(), 'delivery', `/home/dewitt/pipe.sh > ${path('backfill.csv')}`]],
    hint: 'Event time is not arrival time. Reprocess all delivered batches through the tested recipe.',
    beat: ['MERRICK: E5. Earlier than the cutoff, later than the scanner.', 'MERRICK: Someone gets their credit back today.'] },
  { id: 'reconcile', title: 'Count unique events per claim', teaches: ['cut', 'sort', 'uniq'],
    done: w => { const s=read(w,path('counts.txt')); return /^\s*2\s+NAV-7\s*$/m.test(s) && /^\s*2\s+TUG-9\s*$/m.test(s) && rows(s).length===2; },
    routes: [[makeRecipe(), 'delivery', `/home/dewitt/pipe.sh | cut -d , -f 3 | sort | uniq -c > ${path('counts.txt')}`], [makeRecipe(), 'delivery', `/home/dewitt/pipe.sh | cut -d , -f 3 | sort -r | uniq -c | tee ${path('counts.txt')}`], [makeRecipe(), 'delivery', `/home/dewitt/pipe.sh > /tmp/all; cut -d , -f 3 /tmp/all | sort | uniq -c > ${path('counts.txt')}`]],
    misses: [[`echo '3 NAV-7\n2 TUG-9' > ${path('counts.txt')}`], [`echo '2 NAV-7' > ${path('counts.txt')}`]],
    hint: 'Count events, not units or deliveries. One column from the unique rows is enough.',
    beat: ['LUNA: Two events for each claim. The unit totals are a different question. We kept the names on this one.'] },
  { id: 'publish', title: 'Publish the complete export with the right batch checkpoint', teaches: ['mv', 'echo', 'delivery checkpoints'],
    done: w => same(read(w, '/srv/outbox/current.csv'), ALL) && read(w,'/srv/outbox/checkpoint').trim()==='004',
    routes: [[makeRecipe(), 'delivery', '/home/dewitt/pipe.sh > /srv/outbox/staged.csv', 'mv /srv/outbox/staged.csv /srv/outbox/current.csv', "echo 004 > /srv/outbox/checkpoint"], [makeRecipe(), 'delivery', '/home/dewitt/pipe.sh > /tmp/export', 'cp /tmp/export /srv/outbox/current.csv', "echo 004 | tee /srv/outbox/checkpoint"], [makeRecipe(), 'delivery', '/home/dewitt/pipe.sh > /srv/outbox/current.csv', "echo 004 > /srv/outbox/checkpoint"]],
    misses: [["echo 004 > /srv/outbox/checkpoint"], [makeRecipe(), 'delivery', '/home/dewitt/pipe.sh > /srv/outbox/current.csv', 'echo 002 > /srv/outbox/checkpoint']],
    hint: 'The checkpoint names the last received batch, not the newest event time. Advance it after the export is complete. Staging then mv avoids exposing a partial file.',
    beat: ['MERRICK: Export and checkpoint agree. I can tell the counter which deliveries are included.'] },
  { id: 'leave-a-method', title: 'Leave the tested recipe and a usable handover', teaches: ['cat', 'tee', 'operational handover'],
    done: w => verified(w,'replay') && verified(w,'late') && /pipe\.sh/.test(read(w,path('HANDOVER'))) && /rehearse/.test(read(w,path('HANDOVER'))) && /reject/i.test(read(w,path('HANDOVER'))) && /checkpoint/i.test(read(w,path('HANDOVER'))),
    routes: [[makeRecipe(), 'rehearse /home/dewitt/pipe.sh', `echo 'Run /home/dewitt/pipe.sh. Test with rehearse /home/dewitt/pipe.sh. Review rejects.csv. Publish before advancing checkpoint.' > ${path('HANDOVER')}`], [makeRecipe(RECIPE.replace('sort -u','sort | uniq')), 'rehearse /home/dewitt/pipe.sh', `echo 'rehearse /home/dewitt/pipe.sh; pipe.sh emits the export. Review rejects; checkpoint follows publication.' | tee ${path('HANDOVER')}`], [makeRecipe(RECIPE.replace('sort -u','sort -r | uniq')), 'rehearse /home/dewitt/pipe.sh', `echo 'pipe.sh reads all deliveries. rehearse checks it. Keep rejects. Move checkpoint after the output.' > /tmp/note; cp /tmp/note ${path('HANDOVER')}`]],
    misses: [[`echo done > ${path('HANDOVER')}`], [`echo 'pipe.sh rehearse rejects checkpoint' > ${path('HANDOVER')}`]],
    hint: 'Tomorrow someone else gets this desk. Leave the command, its test, the rejects, and the checkpoint rule.',
    beat: ['MERRICK: I followed it without asking you. That is a handover.', 'LUNA: We may now be interrupted by lunch.'] },
];
export const PIPELINE_OBJECTIVES = specs.map((spec, i) => objective(spec, i ? [specs[i-1]!.id] : []));

function attach(machine: Machine, questbook: Questbook) {
  return withCompanion({ machine, questbook }, {
    speaker: 'LUNA', topics: {
      here: ['The scanners retry until someone answers. The accounts used to treat every answer as a new delivery.'],
      merrick: ['He remembers names the forms cannot store. I think that is a useful kind of memory.'],
      joke: ['A batch walks into a bar. A batch walks into a bar. You charge it once. We have improved the joke.'],
      future: ['Keep the recipe. The next broken delivery should cost us less of the afternoon.'],
    },
  });
}
export function bootPipeline() {
  const questbook = new Questbook(PIPELINE_OBJECTIVES);
  const machine = new Machine({ hostname: 'intake', epoch: Date.UTC(2398,6,15,9), commands: commands(questbook) });
  const fs = machine.vfs;
  for (const dir of [INTAKE, '/srv/outbox', WORK, '/tmp']) fs.mkdirp(dir, ROOT_USER);
  fs.chown('/home/dewitt',1000,1000,ROOT_USER); fs.chmod('/tmp',0o777,ROOT_USER);
  fs.chown(WORK,1000,1000,ROOT_USER); fs.chown('/srv/outbox',1000,1000,ROOT_USER);
  fs.writeText(`${INTAKE}/001.csv`,RAW,ROOT_USER); fs.writeText(`${INTAKE}/002.csv`,SECOND,ROOT_USER);
  fs.writeText('/home/dewitt/README', [
    'INTAKE — MERRICK\n',
    'A delivery can arrive twice. A real event can arrive late. Neither should cost someone money.',
    'Source: /srv/intake/001.csv and 002.csv. Do not edit the sources.',
    'v1 fields: id,time,claim,units,version. v2 adds status at the end.',
    'Only rows with numeric units are valid. Keep the bad row; ask its sender to correct it.',
    'Canonical output: id,time,claim,units. No header. One row per event.',
    'Repeated ids in these batches carry the same payload. Conflicting revisions would need a revision policy, not sort -u.',
    '\nWork files (the intake desk reads these names):',
    'work/raw.csv — untouched 001 copy',
    'work/valid.csv and work/rejects.csv — separate 001 without losing rows',
    'work/normalized.csv — valid rows from both batches, first four fields, including repeats',
    'work/events.csv — one canonical row per event',
    '\nWrite an executable /home/dewitt/pipe.sh. It reads /srv/intake/*.csv and prints canonical rows.',
    'rehearse /home/dewitt/pipe.sh tests normal, repeated and late deliveries on isolated copies.',
    'delivery brings in batch 004. Run your recipe into work/backfill.csv.',
    'work/counts.txt — unique event counts per claim (uniq -c format)',
    '/srv/outbox/current.csv — complete canonical export; checkpoint contains last received batch id, 004.',
    'work/HANDOVER — recipe command, rehearse command, reject handling, checkpoint rule.',
    '\nUseful: man grep, man cut, man sort, man uniq, man chmod. Editors: nano or vi.',
    'objectives shows the work. hint gives working commands. talk when you need company.',
  ].join('\n')+'\n', ROOT_USER);
  machine.shell.cwd='/home/dewitt'; machine.shell.env['PWD']='/home/dewitt';
  return attach(machine, questbook);
}
export function restorePipeline(snap: AdventureSnapshot) {
  const book=new Questbook(PIPELINE_OBJECTIVES);book.restore(snap.quest);
  return attach(Machine.restore(snap.machine as MachineSnapshot, { commands: commands(book), hostname: 'intake' }), book);
}
