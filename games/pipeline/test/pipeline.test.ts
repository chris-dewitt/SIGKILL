import { describe, it, expect } from 'vitest';
import { checkObjectives, validateObjectives } from '@sigkill/quest';
import { ROOT_USER } from '@sigkill/machine';
import { bootPipeline, restorePipeline, PIPELINE_OBJECTIVES, RAW, RECIPE } from '../src/world.js';

const factory = () => { const s=bootPipeline(); return { world:s.machine, run:(c:string)=>s.machine.exec(c) }; };

describe('The Pipeline', () => {
  it('executes every declared solution and rejects the near misses', async () => {
    const s=bootPipeline();
    expect(validateObjectives(PIPELINE_OBJECTIVES,{commands:s.machine.shell.commands})).toEqual([]);
    const report=await checkObjectives(PIPELINE_OBJECTIVES,factory);
    expect(report.problems).toEqual([]);
    expect(report.routesChecked).toBe(27);
    expect(report.nearMissesChecked).toBe(18);
  });
  it('is finishable using the bottom of every hint ladder, including after a restore', async () => {
    let s=bootPipeline();
    for(const [i,o] of PIPELINE_OBJECTIVES.entries()) {
      for(const step of o.steps) {
        if(!step.pending(s.machine)) continue;
        const result=await s.machine.exec(step.rungs.at(-1)!.command!);
        expect(result.stderr, o.id).toBe('');
        expect(step.pending(s.machine),o.id).toBe(false);
      }
      s.questbook.drainCompleted(s.machine);
      if(i===4) s=restorePipeline({machine:s.machine.snapshot(),quest:s.questbook.snapshot()});
    }
    expect(s.questbook.complete(s.machine)).toBe(true);
    expect(s.questbook.drainCompleted(s.machine)).toEqual([]);
    expect((await s.machine.exec('talk joke')).stdout).toContain('charge it once');
  });
  it('tests isolated copies, binds a receipt to the recipe, and survives a save', async () => {
    const s=bootPipeline();
    for(const c of PIPELINE_OBJECTIVES[4]!.routes[0]!.commands) await s.machine.exec(c);
    expect(s.machine.vfs.readText('/srv/intake/001.csv',ROOT_USER)).toBe(RAW);
    expect(s.machine.vfs.exists('/srv/intake/003.csv')).toBe(false);
    expect(s.machine.vfs.exists('/srv/intake/004.csv')).toBe(false);
    expect(PIPELINE_OBJECTIVES[4]!.done(s.machine)).toBe(true);
    const back=restorePipeline({machine:s.machine.snapshot(),quest:s.questbook.snapshot()});
    expect(PIPELINE_OBJECTIVES[4]!.done(back.machine)).toBe(true);
    back.machine.vfs.writeText('/home/dewitt/pipe.sh',RECIPE.replace('sort -u','sort'),back.machine.shell.user);
    expect(PIPELINE_OBJECTIVES[4]!.done(back.machine)).toBe(false);
  });
  it('does not let the player forge a rehearsal receipt', async () => {
    const s=bootPipeline();
    for(const c of PIPELINE_OBJECTIVES[4]!.routes[0]!.commands) await s.machine.exec(c);
    const result=await s.machine.exec("echo '{}' > /var/lib/pipeline/rehearsal.json");
    expect(result.code).not.toBe(0);
  });
});
