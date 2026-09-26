import { describe, expect, it } from 'vitest';
import { ROOT_USER } from '@sigkill/machine';
import { bootWreck, restoreWreck } from '../src/world.js';
import { PROJECTS, REPORT } from '../src/act1/projects.js';

async function awake() {
  const w = bootWreck();
  await w.machine.exec('sudo chmod +x /usr/local/bin/hull-check');
  await w.machine.exec('sudo systemctl start hull-monitor');
  w.afterCommand();
  return w;
}

describe('optional crew projects and local conversations', () => {
  it('makes the projects discoverable before LUNA wakes, without adding required objectives', async () => {
    const w = bootWreck();
    expect((await w.machine.exec('ls')).stdout).toContain('projects');
    expect((await w.machine.exec(`cat ${PROJECTS}/README`)).stdout).toContain('Doc');
    expect((await w.machine.exec('luna')).code).toBe(1);
    // Five repairs, two comms, two optional discovery threads. The projects
    // add none of them: they are worth doing and they gate nothing.
    expect(w.questbook.objectives).toHaveLength(9);
    expect(w.questbook.required).toHaveLength(7);
  });

  it('runs the flawed real script, rejects its report, accepts two independent repairs', async () => {
    for (const repair of [
      `grep ',RESEARCH,' ${PROJECTS}/adapter/ledger.csv > ${REPORT}`,
      `sed -i 's/-i research/",RESEARCH,"/' ${PROJECTS}/adapter/audit.sh; ${PROJECTS}/adapter/audit.sh`,
    ]) {
      const w = await awake();
      expect((await w.machine.exec(`${PROJECTS}/adapter/audit.sh`)).code).toBe(0);
      expect((await w.machine.exec('luna adapter')).stdout).toContain('does not match');
      expect((await w.machine.exec(repair)).code).toBe(0);
      expect((await w.machine.exec('luna adapter')).stdout).toContain('exactly the research records');
      await w.machine.exec(`echo junk >> ${REPORT}`);
      expect((await w.machine.exec('luna adapter')).stdout).toContain('does not match');
    }
  });

  it('keeps conversation bounded, permission-aware and silent when she is stopped', async () => {
    const w = await awake();
    expect((await w.machine.exec('luna "what do you know about Vasquez?"')).stdout).toContain('not in the room');
    expect((await w.machine.exec('luna "what the fuck is that?"')).stdout).toContain('Which thing');
    await w.machine.exec(`sudo chmod 000 ${PROJECTS}/adapter/ledger.csv`);
    expect((await w.machine.exec('luna adapter')).stdout).toContain('cannot read');
    await w.machine.exec('pkill -9 luna');
    expect((await w.machine.exec('luna joke')).code).toBe(1);
  });

  it('retains player scripts, evidence and conversation commands across save/restore', async () => {
    const w = await awake();
    const hint = await w.machine.exec('luna adapter hint');
    const command = hint.stdout.split('\n').find(line => line.startsWith('LUNA: grep'))?.slice(6);
    expect(command).toBeDefined();
    await w.machine.exec(command!);
    await w.machine.exec('luna vasquez > /home/dewitt/remember.txt');
    const restored = restoreWreck({ machine: w.machine.snapshot(), quest: w.questbook.snapshot() });
    expect((await restored.machine.exec('luna adapter')).stdout).toContain('exactly the research records');
    expect(restored.machine.vfs.readText('/home/dewitt/remember.txt', ROOT_USER)).toContain('Doc');
  });

  it('does not invent a successful audit from missing or empty evidence', async () => {
    const w = await awake();
    await w.machine.exec(`echo '' > ${PROJECTS}/adapter/ledger.csv`);
    await w.machine.exec(`echo '' > ${REPORT}`);
    expect((await w.machine.exec('luna adapter')).stdout).toContain('missing evidence');
  });
});
