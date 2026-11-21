import { describe, expect, it } from 'vitest';
import { Machine } from '../src/machine.js';
import { ROOT_USER } from '../src/vfs/vfs.js';

/**
 * grep -A, -B and -C.
 *
 * They used to parse as unknown flags and do nothing, so the context a
 * player asked for never appeared and nothing said why. Found writing the
 * finale's ladder.
 */
function boot(): Machine {
  const m = new Machine({ hostname: 'annexe' });
  m.vfs.mkdirp('/home/dewitt', ROOT_USER);
  m.vfs.writeText('/home/dewitt/log', ['a', 'step 4 call x', 'from result', 'b', 'c', 'step 9 call x', 'tail'].join('\n') + '\n', ROOT_USER);
  m.shell.cwd = '/home/dewitt';
  return m;
}

describe('grep context', () => {
  it('-A prints the lines after each match, groups split by --', async () => {
    const r = await boot().exec('grep -A1 call log');
    expect(r.stdout).toBe('step 4 call x\nfrom result\n--\nstep 9 call x\ntail\n');
  });

  it('-B, -C, and a separate argument, all work', async () => {
    const m = boot();
    expect((await m.exec('grep -B 1 result log')).stdout).toBe('step 4 call x\nfrom result\n');
    expect((await m.exec('grep -C1 result log')).stdout).toBe('step 4 call x\nfrom result\nb\n');
  });

  it('marks matches with : and context with - when numbering, as GNU grep does', async () => {
    expect((await boot().exec('grep -n -A1 "step 4" log')).stdout).toBe('2:step 4 call x\n3-from result\n');
  });

  it('merges overlapping context instead of printing a line twice', async () => {
    expect((await boot().exec('grep -A2 -B1 "step 4|from" log')).stdout.split('\n').filter((l) => l === 'from result')).toHaveLength(1);
  });

  it('refuses a context that is not a number', async () => {
    expect((await boot().exec('grep -A x call log')).stderr).toContain('invalid context length');
  });

  it('changes nothing without context', async () => {
    expect((await boot().exec('grep call log')).stdout).toBe('step 4 call x\nstep 9 call x\n');
  });
});
