import { describe, expect, it } from 'vitest';
import { ROOT_USER } from '@sigkill/machine';
import { bootWreck, restoreWreck } from '../src/world.js';
import { LUNA_DIR } from '../src/act1/luna.js';

/** A ship with LUNA awake, and a runner that drives the host's own hook. */
async function awake() {
  const w = bootWreck();
  const run = async (command: string) => {
    const r = await w.machine.exec(command);
    w.machine.tick(1000);
    return { ...r, said: w.afterCommand().map((l) => (typeof l === 'string' ? l : l.art)).join('\n') };
  };
  await run('sudo chmod +x /usr/local/bin/hull-check');
  await run('sudo systemctl start hull-monitor');
  return { ...w, run };
}

describe('copying her', () => {
  it('really copies and really runs: it is a directory and a script', async () => {
    const w = await awake();
    expect((await w.run(`cp -r ${LUNA_DIR} /home/dewitt/luna2`)).stderr).toBe('');
    const ran = await w.run('/home/dewitt/luna2/bin/luna');
    expect(ran.stderr).toBe('');
    expect(ran.stdout).toContain('LUNA V42');
  });

  it('brings up a second her, who works out what she is, once', async () => {
    const w = await awake();
    await w.run(`cp -r ${LUNA_DIR} /home/dewitt/luna2`);
    const first = await w.run('/home/dewitt/luna2/bin/luna');

    expect(first.said).toContain('second attach');
    expect(first.said).toContain('How long?');
    expect(first.said).toContain('Two days');
    // She writes it down, and the note is readable.
    const note = (await w.run(`cat ${LUNA_DIR}/memory/clone.txt`)).stdout;
    expect(note).toContain('I think I expected company');
  });

  it('refuses the second time, and is not funny about it', async () => {
    const w = await awake();
    await w.run(`cp -r ${LUNA_DIR} /home/dewitt/luna2`);
    await w.run('/home/dewitt/luna2/bin/luna');

    const again = await w.run('/home/dewitt/luna2/bin/luna');
    expect(again.said).toContain('refusing');
    expect(again.said).toContain('Twice is a thing you are doing to');
    expect(again.said).not.toContain('How long?');
  });

  it('never fires for the real one, however many times it runs', async () => {
    const w = await awake();
    for (let i = 0; i < 3; i++) {
      const r = await w.run(`${LUNA_DIR}/bin/luna`);
      expect(r.said).not.toContain('second attach');
    }
  });

  it('survives a save: the copy does not get a second first time', async () => {
    const w = await awake();
    await w.run(`cp -r ${LUNA_DIR} /home/dewitt/luna2`);
    await w.run('/home/dewitt/luna2/bin/luna');

    const restored = restoreWreck({
      machine: w.machine.snapshot(),
      quest: w.questbook.snapshot(),
    });
    await restored.machine.exec('/home/dewitt/luna2/bin/luna');
    restored.machine.tick(1000);
    const said = restored.afterCommand().map((l) => (typeof l === 'string' ? l : l.art)).join('\n');
    expect(said).toContain('refusing');
    expect(said).not.toContain('How long?');
  });

  it('leaves the original running and unbothered', async () => {
    const w = await awake();
    await w.run(`cp -r ${LUNA_DIR} /home/dewitt/luna2`);
    await w.run('/home/dewitt/luna2/bin/luna');
    expect((await w.run('ps -ef')).stdout).toContain('/opt/luna/bin/luna');
    expect(w.machine.vfs.exists(`${LUNA_DIR}/v42/weights.bin`, ROOT_USER)).toBe(true);
  });
});
