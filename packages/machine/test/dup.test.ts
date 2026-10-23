import { describe, expect, it } from 'vitest';
import { Machine } from '../src/machine.js';
import { ROOT_USER } from '../src/vfs/vfs.js';

/**
 * `2>&1` and `>&2`.
 *
 * Found by probing game two: keeping a tool's refusal in a file is
 * `cmd > f 2>&1`, and the shell rejected it as a syntax error. It is the first
 * redirection anybody copies out of a real script.
 */
function boot(): Machine {
  const m = new Machine({ hostname: 'nav7' });
  m.vfs.mkdirp('/home/dewitt', ROOT_USER);
  m.vfs.chown('/home/dewitt', 1000, 1000, ROOT_USER);
  m.shell.cwd = '/home/dewitt';
  return m;
}

const read = (m: Machine, path: string): string => m.vfs.readText(path, ROOT_USER);

describe('stream duplication', () => {
  it('sends errors to the file with > f 2>&1', async () => {
    const m = boot();
    const r = await m.exec('cat nope > out.txt 2>&1');
    expect(r.stderr).toBe('');
    expect(read(m, '/home/dewitt/out.txt')).toContain('No such file or directory');
  });

  it('keeps both streams, in one file, in the order they were written', async () => {
    const m = boot();
    await m.exec('echo here > a.txt');
    await m.exec('cat a.txt nope > both.txt 2>&1');
    const both = read(m, '/home/dewitt/both.txt');
    expect(both).toMatch(/^here\n.*No such file/s);
  });

  it('is order-dependent, like a real shell: 2>&1 > f leaves errors on the screen', async () => {
    const m = boot();
    const r = await m.exec('cat nope 2>&1 > out.txt');
    expect(r.stdout).toContain('No such file or directory');
    expect(read(m, '/home/dewitt/out.txt')).toBe('');
  });

  it('puts errors into a pipe', async () => {
    const m = boot();
    const r = await m.exec('cat nope 2>&1 | wc -l');
    expect(r.stderr).toBe('');
    expect(r.stdout.trim()).toBe('1');
  });

  it('sends output to stderr with >&2 and 1>&2', async () => {
    const m = boot();
    for (const form of ['echo oops >&2', 'echo oops 1>&2']) {
      const r = await m.exec(form);
      expect(r.stdout, form).toBe('');
      expect(r.stderr, form).toBe('oops\n');
    }
  });

  it('appends with >> f 2>&1', async () => {
    const m = boot();
    await m.exec('echo first > log');
    await m.exec('cat nope >> log 2>&1');
    expect(read(m, '/home/dewitt/log')).toMatch(/^first\n.*No such file/s);
  });

  it('leaves 2> file and a literal word with a 2 in it alone', async () => {
    const m = boot();
    await m.exec('cat nope 2> err.txt');
    expect(read(m, '/home/dewitt/err.txt')).toContain('No such file');
    expect((await m.exec('echo v2>x; cat x')).stdout).toBe('v2\n');
  });
});
