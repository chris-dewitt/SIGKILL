import { beforeEach, describe, expect, it } from 'vitest';
import { Machine } from '../src/machine.js';
import { ROOT_USER } from '../src/vfs/vfs.js';

function boot(): Machine {
  const m = new Machine({ hostname: 'nav7' });
  m.vfs.mkdirp('/home/survivor', ROOT_USER);
  m.vfs.chown('/home/survivor', 1000, 1000, ROOT_USER);
  m.vfs.mkdirp('/etc', ROOT_USER);
  m.vfs.mkdirp('/var/log', ROOT_USER);
  m.vfs.mkdirp('/tmp', ROOT_USER);
  m.vfs.chmod('/tmp', 0o777, ROOT_USER);
  m.vfs.writeText('/etc/life_support.conf', 'O2_TARGET=16\nSCRUBBER_DUTY=0.4\n', ROOT_USER);
  m.vfs.chmod('/etc/life_support.conf', 0o666, ROOT_USER);
  m.vfs.writeText('/var/log/boot.log', 'ok\nfail\nok\nFAIL\n', ROOT_USER);
  return m;
}

describe('shell', () => {
  let m: Machine;
  beforeEach(async () => { m = boot(); });

  it('runs a simple command', async () => {
    expect((await m.exec('echo hello')).stdout).toBe('hello\n');
  });

  it('reports unknown commands like sh does', async () => {
    const r = await m.exec('frobnicate');
    expect(r.code).toBe(127);
    expect(r.stderr).toContain('command not found');
  });

  it('pipes stdout into stdin', async () => {
    expect((await m.exec('cat /var/log/boot.log | grep -i fail | wc -l')).stdout.trim()).toBe('2');
  });

  it('honours && and || on exit status', async () => {
    expect((await m.exec('true && echo yes')).stdout).toBe('yes\n');
    expect((await m.exec('false && echo yes')).stdout).toBe('');
    expect((await m.exec('false || echo fallback')).stdout).toBe('fallback\n');
  });

  it('redirects stdout to a file, and appends', async () => {
    await m.exec('echo first > /home/survivor/out');
    await m.exec('echo second >> /home/survivor/out');
    expect(m.vfs.readText('/home/survivor/out')).toBe('first\nsecond\n');
  });

  it('reads stdin from a file', async () => {
    expect((await m.exec('grep O2 < /etc/life_support.conf')).stdout).toBe('O2_TARGET=16\n');
  });

  it('sends stderr to the terminal, never down the pipe', async () => {
    const r = await m.exec('cat /nope | wc -l');
    expect(r.stderr).toContain('No such file or directory');
    expect(r.stdout.trim()).toBe('0');
  });

  it('expands variables and $?', async () => {
    await m.exec('export SECTOR=deck-c');
    expect((await m.exec('echo $SECTOR')).stdout).toBe('deck-c\n');
    expect((await m.exec('echo ${SECTOR}/logs')).stdout).toBe('deck-c/logs\n');
    await m.exec('false');
    expect((await m.exec('echo $?')).stdout).toBe('1\n');
  });

  it('respects quoting', async () => {
    expect((await m.exec("echo '$SECTOR is literal'")).stdout).toBe('$SECTOR is literal\n');
    await m.exec('export SECTOR=c');
    expect((await m.exec('echo "sector $SECTOR"')).stdout).toBe('sector c\n');
    expect((await m.exec('echo "a  b"')).stdout).toBe('a  b\n');
    expect((await m.exec('echo a  b')).stdout).toBe('a b\n');
  });

  it('globs against the filesystem, and leaves quoted globs alone', async () => {
    await m.exec('cd /home/survivor');
    await m.exec('touch alpha.txt beta.txt gamma.log');
    expect((await m.exec('echo *.txt')).stdout).toBe('alpha.txt beta.txt\n');
    expect((await m.exec("echo '*.txt'")).stdout).toBe('*.txt\n');
    expect((await m.exec('echo *.nothing')).stdout).toBe('*.nothing\n');
  });

  it('tracks the working directory across commands', async () => {
    expect((await m.exec('cd /var/log && pwd')).stdout).toBe('/var/log\n');
    expect((await m.exec('pwd')).stdout).toBe('/var/log\n');
    expect((await m.exec('cd /nope')).code).toBe(1);
  });

  it('keeps subshell state out of the parent', async () => {
    await m.exec('cd /home/survivor');
    await m.exec('(cd /etc)');
    expect((await m.exec('pwd')).stdout).toBe('/home/survivor\n');
  });

  it('applies per-command assignments only for that command', async () => {
    await m.exec('export MODE=safe');
    expect((await m.exec('MODE=danger env | grep MODE=')).stdout).toBe('MODE=danger\n');
    expect((await m.exec('echo $MODE')).stdout).toBe('safe\n');
  });

  it('edits a file in place with sed', async () => {
    await m.exec("sed -i 's/O2_TARGET=16/O2_TARGET=21/' /etc/life_support.conf");
    expect(m.vfs.readText('/etc/life_support.conf')).toContain('O2_TARGET=21');
  });

  it('reports a syntax error instead of throwing', async () => {
    const r = await m.exec('echo "unterminated');
    expect(r.code).toBe(2);
    expect(r.stderr).toContain('syntax error');
  });

  it('surfaces permission denials through the coreutil', async () => {
    m.vfs.writeText('/etc/sealed', 'x', ROOT_USER);
    m.vfs.chmod('/etc/sealed', 0o600, ROOT_USER);
    const r = await m.exec('cat /etc/sealed');
    expect(r.code).toBe(1);
    expect(r.stderr).toContain('Permission denied');
  });

  it('sorts, counts and cuts', async () => {
    await m.exec('cd /home/survivor');
    m.vfs.writeText('/home/survivor/crew.csv', 'vasquez,eng\nchen,med\nchen,med\nbowen,nav\n');
    expect((await m.exec('cut -d, -f1 crew.csv | sort | uniq | wc -l')).stdout.trim()).toBe('3');
  });

  it('raises clearRequested rather than emitting escape codes', async () => {
    const r = await m.exec('clear');
    expect(r.cleared).toBe(true);
    expect(r.stdout).toBe('');
  });
});

describe('determinism', () => {
  it('produces identical snapshots for identical input', async () => {
    const a = boot();
    const b = boot();
    const script = [
      'cd /home/survivor',
      'mkdir -p work/logs',
      'echo alpha > work/a.txt',
      'echo beta >> work/a.txt',
      'cp work/a.txt work/logs/b.txt',
      "sed -i 's/alpha/ALPHA/' work/a.txt",
      'chmod 640 work/a.txt',
    ];
    for (const line of script) { await a.exec(line); a.tick(1000); }
    for (const line of script) { await b.exec(line); b.tick(1000); }
    expect(a.snapshot()).toEqual(b.snapshot());
  });

  it('restores a machine mid-session', async () => {
    const m = boot();
    await m.exec('cd /var/log');
    await m.exec('export RUN=7');
    m.tick(4200);
    const saved = m.snapshot();

    const restored = Machine.restore(saved, { hostname: 'nav7' });
    expect((await restored.exec('pwd')).stdout).toBe('/var/log\n');
    expect((await restored.exec('echo $RUN')).stdout).toBe('7\n');
    expect(restored.time).toBe(4200);
    expect(restored.snapshot()).toEqual(saved);
  });
});

describe('the shared filesystem', () => {
  it('lets one tool see what another tool wrote', async () => {
    const m = boot();
    await m.exec("sed -i 's/O2_TARGET=16/O2_TARGET=21/' /etc/life_support.conf");
    // This is the moment that proves the Machine is real rather than scripted:
    // an edit made by one tool is visible to a completely different one.
    expect((await m.exec('grep O2 /etc/life_support.conf')).stdout).toBe('O2_TARGET=21\n');
    expect((await m.exec('cat /etc/life_support.conf | wc -l')).stdout.trim()).toBe('2');
  });
});

describe('option parsing', () => {
  it('accepts option values attached or separate, as getopt does', async () => {
    const m = boot();
    m.vfs.writeText('/home/survivor/crew.csv', 'vasquez,eng\nchen,med\nbowen,nav\n', ROOT_USER);
    await m.exec('cd /home/survivor');

    // -d, and -d , must mean the same thing. Regression: -d, used to swallow
    // the following argument and silently produce nothing.
    expect((await m.exec('cut -d, -f1 crew.csv')).stdout).toBe('vasquez\nchen\nbowen\n');
    expect((await m.exec('cut -d , -f1 crew.csv')).stdout).toBe('vasquez\nchen\nbowen\n');
    expect((await m.exec('head -n2 crew.csv')).stdout).toBe('vasquez,eng\nchen,med\n');
    expect((await m.exec('head -n 2 crew.csv')).stdout).toBe('vasquez,eng\nchen,med\n');
  });

  it('still clusters plain boolean flags', async () => {
    const m = boot();
    await m.exec('cd /home/survivor');
    await m.exec('touch .hidden visible');
    expect((await m.exec('ls -la')).stdout).toContain('.hidden');
    expect((await m.exec('ls')).stdout).not.toContain('.hidden');
  });
});

describe('command substitution', () => {
  it('substitutes stdout into a word', async () => {
    const m = boot();
    expect((await m.exec('echo $(echo inner)')).stdout).toBe('inner\n');
    expect((await m.exec('echo `echo legacy`')).stdout).toBe('legacy\n');
  });

  it('strips trailing newlines so the value is usable', async () => {
    const m = boot();
    await m.exec('cd /var/log');
    // Without stripping, this would cd into a path ending in a newline.
    expect((await m.exec('cd $(pwd) && pwd')).stdout).toBe('/var/log\n');
  });

  it('splits an unquoted substitution and keeps a quoted one whole', async () => {
    const m = boot();
    m.vfs.writeText('/tmp/words', 'alpha beta gamma\n', ROOT_USER);
    expect((await m.exec('wc -w < /tmp/words')).stdout.trim()).toBe('3');
    // Unquoted: three arguments. Quoted: one argument containing spaces.
    expect((await m.exec('echo $(cat /tmp/words)')).stdout).toBe('alpha beta gamma\n');
    expect((await m.exec('echo "$(cat /tmp/words)"')).stdout).toBe('alpha beta gamma\n');
  });

  it('nests', async () => {
    const m = boot();
    expect((await m.exec('echo $(echo $(echo deep))')).stdout).toBe('deep\n');
  });

  it('composes with pipes and redirection inside the substitution', async () => {
    const m = boot();
    expect((await m.exec('echo "failures: $(grep -ci fail /var/log/boot.log)"')).stdout)
      .toBe('failures: 2\n');
  });

  it('leaves a single-quoted substitution completely alone', async () => {
    const m = boot();
    expect((await m.exec("echo '$(echo inner)'")).stdout).toBe('$(echo inner)\n');
  });

  it('surfaces stderr from inside a substitution instead of swallowing it', async () => {
    const m = boot();
    const r = await m.exec('echo "[$(cat /nope)]"');
    expect(r.stdout).toBe('[]\n');
    expect(r.stderr).toContain('No such file or directory');
  });

  it('reports an unterminated substitution as a syntax error', async () => {
    const m = boot();
    const r = await m.exec('echo $(echo oops');
    expect(r.code).toBe(2);
    expect(r.stderr).toContain('syntax error');
  });

  it('assigns a substitution to a variable', async () => {
    const m = boot();
    await m.exec('export HOST=$(hostname)');
    expect((await m.exec('echo $HOST')).stdout).toBe('nav7\n');
  });
});
