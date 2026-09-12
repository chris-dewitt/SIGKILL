import { describe, expect, it } from 'vitest';
import { Machine, ROOT_USER, type ScreenProgram } from '@sigkill/machine';
import { applyWrite, editorCommands, flushPendingWrite } from '../src/commands.js';

function boot(): Machine {
  const m = new Machine({ hostname: 'nav7', commands: editorCommands() });
  const v = m.vfs;
  v.mkdirp('/home/survivor', ROOT_USER);
  v.chown('/home/survivor', 1000, 1000, ROOT_USER);
  v.mkdirp('/etc', ROOT_USER);
  v.writeText('/etc/life_support.conf', 'O2_TARGET=16\nSCRUBBER_DUTY=0.4\n', ROOT_USER);
  v.chmod('/etc/life_support.conf', 0o666, ROOT_USER);
  v.writeText('/etc/shadow', 'root:!locked\n', ROOT_USER);
  v.chmod('/etc/shadow', 0o600, ROOT_USER);
  m.shell.cwd = '/home/survivor';
  return m;
}

/** Stand in for the host: drive the program, then put its text on the disk. */
function drive(m: Machine, program: ScreenProgram, script: string): string | undefined {
  const user = m.shell.user;
  for (const k of script.match(/<[^>]+>|[\s\S]/g) ?? []) {
    const named = /^<(.+)>$/.exec(k);
    const ctrl = named ? /^C-(.+)$/.exec(named[1]!) : null;
    program.key(ctrl ? { key: ctrl[1]!, ctrl: true } : { key: named ? named[1]! : k });

    const failed = flushPendingWrite(m.vfs, program, user);
    if (failed) return failed;

    const done = program.exit;
    if (done) {
      return done.write ? applyWrite(m.vfs, program.path, done.text, user) : undefined;
    }
  }
  return undefined;
}

describe('launching an editor', () => {
  it('hands a program to the host instead of printing anything', async () => {
    const m = boot();
    const r = await m.exec('vi /etc/life_support.conf');
    expect(r.code).toBe(0);
    expect(r.stdout).toBe('');
    expect(r.screen?.name).toBe('vi');
    expect(r.screen?.path).toBe('/etc/life_support.conf');
  });

  it('resolves a relative path against the working directory', async () => {
    const m = boot();
    await m.exec('echo hi > notes.txt');
    const r = await m.exec('vi notes.txt');
    expect(r.screen?.path).toBe('/home/survivor/notes.txt');
  });

  it('asks which file rather than opening nothing', async () => {
    const m = boot();
    const r = await m.exec('vi');
    expect(r.code).toBe(1);
    expect(r.stderr).toContain('which file?');
    expect(r.screen).toBeUndefined();
  });

  it('refuses a directory', async () => {
    const m = boot();
    const r = await m.exec('vi /etc');
    expect(r.code).toBe(1);
    expect(r.stderr).toContain('is a directory');
  });

  it('offers vim and nano as well', async () => {
    const m = boot();
    expect((await m.exec('vim /etc/life_support.conf')).screen?.name).toBe('vi');
    expect((await m.exec('nano /etc/life_support.conf')).screen?.name).toBe('nano');
  });

  it('opens a file that does not exist yet, where the directory allows it', async () => {
    const m = boot();
    const r = await m.exec('vi fresh.txt');
    expect(r.code).toBe(0);
    expect(r.screen).toBeDefined();
  });

  // Finding out at :w is how people lose work in real editors.
  it('refuses a new file in a directory it cannot write, before opening', async () => {
    const m = boot();
    const r = await m.exec('vi /etc/brand_new.conf');
    expect(r.code).toBe(1);
    expect(r.stderr).toContain('permission denied');
  });

  it('will not open a file it cannot even read', async () => {
    const m = boot();
    const r = await m.exec('vi /etc/shadow');
    expect(r.code).toBe(1);
    expect(r.screen).toBeUndefined();
  });

  it('opens a file it can read but not write, read-only', async () => {
    const m = boot();
    m.vfs.writeText('/etc/motd', 'no editing\n', ROOT_USER);
    m.vfs.chmod('/etc/motd', 0o444, ROOT_USER);
    const r = await m.exec('vi /etc/motd');
    expect(r.code).toBe(0);
    expect(r.screen?.frame().at(-1)?.text).toContain('[readonly]');
  });
});

// The whole point: what the editor wrote is in the same filesystem grep reads.
describe('one filesystem, one editor', () => {
  it('vi writes a change that grep then sees', async () => {
    const m = boot();
    expect((await m.exec('grep O2 /etc/life_support.conf')).stdout).toBe('O2_TARGET=16\n');

    const program = (await m.exec('vi /etc/life_support.conf')).screen!;
    expect(drive(m, program, ':%s/16/21/<Enter>:wq<Enter>')).toBeUndefined();

    expect((await m.exec('grep O2 /etc/life_support.conf')).stdout).toBe('O2_TARGET=21\n');
    expect((await m.exec('wc -l /etc/life_support.conf')).stdout.trim()).toMatch(/^2/);
  });

  it('nano writes a change that cat then sees', async () => {
    const m = boot();
    const program = (await m.exec('nano /etc/life_support.conf')).screen!;
    drive(m, program, '#<C-o><C-x>');
    expect((await m.exec('cat /etc/life_support.conf')).stdout).toBe('#O2_TARGET=16\nSCRUBBER_DUTY=0.4\n');
  });

  it('creates a file on disk that did not exist before', async () => {
    const m = boot();
    const program = (await m.exec('vi plan.txt')).screen!;
    drive(m, program, 'ivent the deck<Escape>:wq<Enter>');
    expect((await m.exec('cat plan.txt')).stdout).toBe('vent the deck\n');
  });

  it(':q! leaves the file exactly as it was', async () => {
    const m = boot();
    const before = (await m.exec('cat /etc/life_support.conf')).stdout;
    const program = (await m.exec('vi /etc/life_support.conf')).screen!;
    drive(m, program, 'dddd:q!<Enter>');
    expect((await m.exec('cat /etc/life_support.conf')).stdout).toBe(before);
  });

  it(':w reaches the disk without waiting for the editor to close', async () => {
    const m = boot();
    const program = (await m.exec('vi /etc/life_support.conf')).screen!;
    drive(m, program, 'dd:w<Enter>');
    expect(program.exit).toBeNull();
    expect((await m.exec('cat /etc/life_support.conf')).stdout).toBe('SCRUBBER_DUTY=0.4\n');
  });

  it('reports a write that the filesystem refuses rather than losing it quietly', () => {
    const m = boot();
    m.vfs.writeText('/etc/locked.conf', 'x\n', ROOT_USER);
    m.vfs.chmod('/etc/locked.conf', 0o444, ROOT_USER);
    const failed = applyWrite(m.vfs, '/etc/locked.conf', 'changed\n', m.shell.user);
    expect(failed).toContain('/etc/locked.conf');
    expect(m.vfs.readText('/etc/locked.conf', ROOT_USER)).toBe('x\n');
  });
});

describe('a machine with no screen', () => {
  // A cron job that runs vi must not hang; it simply has nobody to draw to.
  it('runs vi as a no-op instead of hanging', async () => {
    const m = boot();
    const r = await m.exec('vi /etc/life_support.conf && echo after');
    expect(r.code).toBe(0);
    expect(r.stdout).toContain('after');
    expect(m.vfs.readText('/etc/life_support.conf', ROOT_USER)).toContain('16');
  });
});
