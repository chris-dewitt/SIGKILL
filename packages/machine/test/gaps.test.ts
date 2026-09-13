import { describe, expect, it } from 'vitest';
import { Machine } from '../src/machine.js';
import { ROOT_USER } from '../src/vfs/vfs.js';
import { parseMode, takeCountOperand } from '../src/coreutils/helpers.js';

/**
 * `parseMode` returns null for a spec that is not a mode at all, so the happy
 * path is asserted through this and the null path is asserted on its own.
 */
function octal(spec: string, current: number): string {
  const mode = parseMode(spec, current);
  expect(mode, `parseMode('${spec}') should be a mode`).not.toBeNull();
  return (mode ?? 0).toString(8);
}

/**
 * Everything here came out of one sweep: the commands and flag forms a player
 * actually typed in Act I that the shell did not accept. Each test names the
 * thing somebody reached for.
 */
function boot(): Machine {
  const m = new Machine({ hostname: 'nav7', epoch: Date.UTC(2387, 2, 14) });
  const v = m.vfs;
  v.mkdirp('/home/survivor', ROOT_USER);
  v.chown('/home/survivor', 1000, 1000, ROOT_USER);
  v.mkdirp('/etc/systemd/system', ROOT_USER);
  v.mkdirp('/var/log', ROOT_USER);
  v.chmod('/var/log', 0o777, ROOT_USER);
  v.writeText('/etc/life_support.conf', 'O2_TARGET=16\nSCRUBBER_DUTY=0.4\n', ROOT_USER);
  v.writeText('/etc/crew.csv', 'vasquez,eng,dead\nchen,med,dead\nbowen,nav,unknown\n', ROOT_USER);
  v.writeText('/etc/systemd/system/scrubber.service', '[Unit]\nDescription=Scrubber O2\n', ROOT_USER);
  v.writeText('/etc/shadow', 'root:!locked\n', ROOT_USER);
  v.chmod('/etc/shadow', 0o600, ROOT_USER);
  v.writeText('/home/survivor/ten.txt', Array.from({ length: 10 }, (_, i) => `line ${i + 1}`).join('\n') + '\n', ROOT_USER);
  v.chown('/home/survivor/ten.txt', 1000, 1000, ROOT_USER);
  m.shell.cwd = '/home/survivor';
  return m;
}

describe('head and tail take the number the way people type it', () => {
  it('head -3 works, not just head -n 3', async () => {
    const m = boot();
    const bare = await m.exec('head -3 ten.txt');
    expect(bare.stderr).toBe('');
    expect(bare.stdout).toBe('line 1\nline 2\nline 3\n');
    expect(bare.stdout).toBe((await m.exec('head -n 3 ten.txt')).stdout);
  });

  it('tail -2 works too', async () => {
    const m = boot();
    expect((await m.exec('tail -2 ten.txt')).stdout).toBe('line 9\nline 10\n');
  });

  it('still defaults to ten lines with no count at all', async () => {
    const m = boot();
    expect((await m.exec('head ten.txt')).stdout.trim().split('\n')).toHaveLength(10);
  });

  it('-n wins when both forms are given, and neither is read as a filename', async () => {
    const m = boot();
    const r = await m.exec('head -5 -n 2 ten.txt');
    expect(r.stderr).toBe('');
    expect(r.stdout).toBe('line 1\nline 2\n');
  });

  it('does not mistake a file whose name starts with a dash for a count', () => {
    expect(takeCountOperand(['ten.txt', '-5'])).toEqual({ count: undefined, rest: ['ten.txt', '-5'] });
    expect(takeCountOperand(['-5', 'ten.txt'])).toEqual({ count: 5, rest: ['ten.txt'] });
  });
});

describe('chmod takes symbolic modes, which is how anyone makes a script run', () => {
  it('+x adds execute for everybody', () => {
    expect(octal('+x', 0o644)).toBe('755');
  });

  it('u+w, go-rwx and a=r do what they say', () => {
    expect(octal('u+w', 0o444)).toBe('644');
    expect(octal('go-rwx', 0o777)).toBe('700');
    expect(octal('a=r', 0o777)).toBe('444');
  });

  it('handles comma-separated clauses', () => {
    expect(octal('u+rw,go-w', 0o666)).toBe('644');
  });

  // X is the one that makes `chmod -R a+X` safe across a mixed tree.
  it('X only adds execute where some execute bit is already set', () => {
    expect(octal('a+X', 0o644)).toBe('644');
    expect(octal('a+X', 0o744)).toBe('755');
  });

  it('still takes octal, and rejects nonsense with a helpful message', async () => {
    expect(octal('755', 0o644)).toBe('755');
    expect(parseMode('u+q', 0o644)).toBeNull();

    const m = boot();
    const r = await m.exec('chmod wat ten.txt');
    expect(r.code).not.toBe(0);
    expect(r.stderr).toContain('+x');
  });

  it('applies through the shell, per file, against what each one already is', async () => {
    const m = boot();
    await m.exec('touch a.sh b.sh && chmod 700 a.sh && chmod 644 b.sh');
    await m.exec('chmod +x a.sh b.sh');
    const listing = (await m.exec('ls -l a.sh b.sh')).stdout;
    expect(listing).toContain('rwx');
    expect(listing.split('\n').filter((l) => l.includes('.sh'))).toHaveLength(2);
  });
});

describe('grep -r, because the README sends you to look in a directory', () => {
  it('searches a whole tree instead of refusing a directory', async () => {
    const m = boot();
    const r = await m.exec('grep -r O2 /etc/systemd');
    expect(r.code).toBe(0);
    expect(r.stdout).toContain('/etc/systemd/system/scrubber.service:Description=Scrubber O2');
  });

  it('names the file even when only one line matches, which is the point', async () => {
    const m = boot();
    expect((await m.exec('grep -r SCRUBBER_DUTY /etc')).stdout).toContain('/etc/life_support.conf:');
  });

  it('-R is accepted as well, and combines with -n and -i', async () => {
    const m = boot();
    const r = await m.exec('grep -Rni o2_target /etc');
    expect(r.stdout).toMatch(/\/etc\/life_support\.conf:1:O2_TARGET=16/);
  });

  /**
   * /etc/shadow is unreadable, on purpose and forever. GNU grep names the file
   * it could not open on stderr, still prints everything it *did* find, and
   * exits 2 because an error occurred. All three of those matter: the matches
   * are the player's, the error is true, and the exit code says so.
   */
  it('keeps the matches it found when one file is unreadable', async () => {
    const m = boot();
    const r = await m.exec('grep -r O2_TARGET /etc');
    expect(r.stdout).toContain('/etc/life_support.conf:O2_TARGET=16');
    expect(r.stderr).toContain('shadow');
    expect(r.code).toBe(2);
  });

  it('reports no match honestly, when nothing got in the way', async () => {
    const m = boot();
    const r = await m.exec('grep -r zzznotthere /etc/systemd');
    expect(r.code).toBe(1);
    expect(r.stdout).toBe('');
    expect(r.stderr).toBe('');
  });
});

describe('date reads the ship clock and never the wall clock', () => {
  it('prints the adventure calendar, not today', async () => {
    const m = boot();
    expect((await m.exec('date')).stdout).toContain('2387');
  });

  it('is deterministic: same tick, same answer', async () => {
    const a = boot();
    const b = boot();
    expect((await a.exec('date')).stdout).toBe((await b.exec('date')).stdout);
  });

  it('moves only when ship time moves', async () => {
    const m = boot();
    const before = (await m.exec('date +%H:%M:%S')).stdout;
    await m.exec('sleep 90');
    const after = (await m.exec('date +%H:%M:%S')).stdout;
    expect(after).not.toBe(before);
    expect(after.trim()).toBe('00:01:30');
  });

  it('formats with the usual codes', async () => {
    const m = boot();
    expect((await m.exec('date +%Y-%m-%d')).stdout.trim()).toBe('2387-03-14');
    expect((await m.exec('date +%%')).stdout.trim()).toBe('%');
  });
});

describe('the small commands people reach for', () => {
  it('uname says what the machine is', async () => {
    const m = boot();
    expect((await m.exec('uname')).stdout.trim()).toBe('NAV-OS');
    const all = (await m.exec('uname -a')).stdout;
    expect(all).toContain('nav7');
    expect(all).toContain('degraded');
  });

  it('df measures the real filesystem rather than inventing a number', async () => {
    const m = boot();
    const before = (await m.exec('df')).stdout;
    await m.exec('python3 -c "pass" 2>/dev/null; yes > /dev/null 2>&1; true');
    m.vfs.writeText('/var/log/big.log', 'x'.repeat(200_000), ROOT_USER);
    const after = (await m.exec('df')).stdout;
    expect(after).not.toBe(before);
    expect((await m.exec('df -h')).stdout).toMatch(/[KM]/);
  });

  it('basename and dirname split a path the way scripts need', async () => {
    const m = boot();
    expect((await m.exec('basename /etc/life_support.conf')).stdout.trim()).toBe('life_support.conf');
    expect((await m.exec('basename /etc/life_support.conf .conf')).stdout.trim()).toBe('life_support');
    expect((await m.exec('dirname /etc/life_support.conf')).stdout.trim()).toBe('/etc');
    expect((await m.exec('dirname ten.txt')).stdout.trim()).toBe('.');
    expect((await m.exec('basename /etc/')).stdout.trim()).toBe('etc');
    expect((await m.exec('dirname /etc')).stdout.trim()).toBe('/');
  });

  it('tee saves a pipeline and keeps it flowing, which > cannot', async () => {
    const m = boot();
    const r = await m.exec('cat /etc/crew.csv | grep dead | tee /home/survivor/dead.txt');
    expect(r.stdout).toContain('vasquez');
    expect((await m.exec('wc -l dead.txt')).stdout.trim()).toMatch(/^2/);
  });

  it('tee -a adds to a file instead of replacing it', async () => {
    const m = boot();
    await m.exec('echo one | tee log.txt');
    await m.exec('echo two | tee -a log.txt');
    expect((await m.exec('cat log.txt')).stdout).toBe('one\ntwo\n');
  });

  it('tee reports a file it cannot write and still passes the pipe through', async () => {
    const m = boot();
    const r = await m.exec('echo hi | tee /etc/nope.txt');
    expect(r.stderr).toContain('tee:');
    expect(r.stdout).toBe('hi\n');
  });
});

/**
 * Eight findings from an automated review of the change above. Every one was
 * real; each test names the command that was wrong.
 */
describe('the review findings', () => {
  it('grep -r with no path searches the current directory', async () => {
    const m = boot();
    await m.exec('mkdir -p sub && echo needle > sub/a.txt');
    const r = await m.exec('grep -r needle');
    expect(r.code).toBe(0);
    expect(r.stdout).toContain('needle');
  });

  it('grep -r says so when it cannot read a directory, and exits 2', async () => {
    const m = boot();
    m.vfs.mkdirp('/home/survivor/locked', ROOT_USER);
    m.vfs.writeText('/home/survivor/locked/x.txt', 'needle\n', ROOT_USER);
    m.vfs.chmod('/home/survivor/locked', 0o000, ROOT_USER);

    const r = await m.exec('grep -r needle .');
    expect(r.stderr).toContain('locked');
    // Silently reporting "no matches" for a tree it never looked inside is the
    // failure that matters here, not the exit code on its own.
    expect(r.code).toBe(2);
  });

  it('the epoch survives a snapshot, so date does not jump across a save', async () => {
    const m = new Machine({ epoch: 0 });
    const before = (await m.exec('date +%s')).stdout;
    const restored = Machine.restore(m.snapshot());
    expect((await restored.exec('date +%s')).stdout).toBe(before);
    expect(m.snapshot().epoch).toBe(0);
  });

  it('an explicit epoch still beats the snapshot, because the caller asked', async () => {
    const m = new Machine({ epoch: 0 });
    const restored = Machine.restore(m.snapshot(), { epoch: 86_400_000 });
    expect((await restored.exec('date +%s')).stdout.trim()).toBe('86400');
  });

  it('chmod -x is a mode, not an unknown flag', async () => {
    const m = boot();
    await m.exec('touch s.sh && chmod 755 s.sh');
    const r = await m.exec('chmod -x s.sh');
    expect(r.stderr).toBe('');
    expect((await m.exec('ls -l s.sh')).stdout).not.toContain('x');
  });

  it('chmod still rejects something that is not a mode at all', async () => {
    const m = boot();
    await m.exec('touch s.sh');
    const r = await m.exec('chmod nonsense s.sh');
    expect(r.code).not.toBe(0);
    expect(r.stderr).toContain('invalid mode');
  });

  it('head -- -5 reads the file called -5', async () => {
    const m = boot();
    m.vfs.writeText('/home/survivor/-5', 'a file, not a count\n', ROOT_USER);
    m.vfs.chown('/home/survivor/-5', 1000, 1000, ROOT_USER);
    const r = await m.exec('head -- -5');
    expect(r.stdout).toBe('a file, not a count\n');
  });

  it('dirname / is /, not the current directory', async () => {
    const m = boot();
    expect((await m.exec('dirname /')).stdout.trim()).toBe('/');
    expect((await m.exec('dirname ///')).stdout.trim()).toBe('/');
    expect((await m.exec('dirname /etc')).stdout.trim()).toBe('/');
  });

  it('a+X makes a directory traversable, which is the point of X', async () => {
    const m = boot();
    await m.exec('mkdir d && chmod 644 d');
    await m.exec('chmod a+X d');
    expect((m.vfs.lstat('/home/survivor/d', ROOT_USER).mode & 0o777).toString(8)).toBe('755');
  });

  it('a+X still leaves a plain file alone', async () => {
    const m = boot();
    await m.exec('touch notes.txt && chmod 644 notes.txt');
    await m.exec('chmod a+X notes.txt');
    expect((m.vfs.lstat('/home/survivor/notes.txt', ROOT_USER).mode & 0o777).toString(8)).toBe('644');
  });

  /**
   * The worst of the eight. `vfs.chmod` follows a symlink to its target, but
   * the mode was read with `lstat`, which returns the link's own fixed 0777.
   * `chmod g+r link` on a 0600 file therefore wrote 0777 to it: world write
   * and execute on a private file, from a command that asked for group read.
   */
  it('a symbolic chmod through a symlink uses the target mode', async () => {
    const m = boot();
    m.vfs.writeText('/home/survivor/secret.txt', 'private\n', ROOT_USER);
    m.vfs.chmod('/home/survivor/secret.txt', 0o600, ROOT_USER);
    m.vfs.chown('/home/survivor/secret.txt', 1000, 1000, ROOT_USER);
    await m.exec('ln -s secret.txt link');

    await m.exec('chmod g+r link');
    const mode = (m.vfs.lstat('/home/survivor/secret.txt', ROOT_USER).mode & 0o777).toString(8);
    expect(mode).toBe('640');
    expect(mode).not.toBe('777');
  });
});
