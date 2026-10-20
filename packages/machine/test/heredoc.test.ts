import { describe, expect, it } from 'vitest';
import { Machine } from '../src/machine.js';
import { ROOT_USER } from '../src/vfs/vfs.js';
import { needsMoreInput } from '../src/index.js';

/**
 * Here-documents.
 *
 * `cat > file <<'EOF'` is how anybody writes a short file from a shell, and
 * from game three on the player writes Python. Without it every script went
 * through `vi`, which on a phone is the slow way to write six lines.
 */
function boot(): Machine {
  const m = new Machine({ hostname: 'nav7' });
  m.vfs.mkdirp('/home/dewitt', ROOT_USER);
  m.vfs.chown('/home/dewitt', 1000, 1000, ROOT_USER);
  m.shell.cwd = '/home/dewitt';
  m.shell.env.NAME = 'DeWitt';
  return m;
}

describe('here-documents', () => {
  it('write a file, literally, with a quoted delimiter', async () => {
    const m = boot();
    const r = await m.exec("cat > calc.py <<'EOF'\nprint('hi $NAME')\nprint(`x`)\nEOF");
    expect(r.stderr).toBe('');
    expect(m.vfs.readText('/home/dewitt/calc.py', ROOT_USER)).toBe("print('hi $NAME')\nprint(`x`)\n");
  });

  it('keep blank lines and indentation, which a Python body is made of', async () => {
    const m = boot();
    await m.exec("cat > f.py <<'EOF'\ndef f(x):\n    return x\n\nprint(f(1))\nEOF");
    expect(m.vfs.readText('/home/dewitt/f.py', ROOT_USER)).toBe('def f(x):\n    return x\n\nprint(f(1))\n');
  });

  it('treat a double-quoted or escaped delimiter as quoted too', async () => {
    const m = boot();
    expect((await m.exec('cat <<"Q"\n$NAME\nQ')).stdout).toBe('$NAME\n');
    expect((await m.exec('cat <<\\Q\n$NAME\nQ')).stdout).toBe('$NAME\n');
  });

  it('expand variables and substitutions with a bare delimiter, and keep quotes as characters', async () => {
    const m = boot();
    const r = await m.exec('cat <<EOF\nhello $NAME, ${NAME}, $(echo sub) `echo tick` "q"\nEOF');
    expect(r.stdout).toBe('hello DeWitt, DeWitt, sub tick "q"\n');
  });

  it('leave an escaped dollar, backtick or backslash alone', async () => {
    const m = boot();
    const r = await m.exec('cat <<EOF\n\\$NAME \\`echo no\\` \\\\\nEOF');
    expect(r.stdout).toBe('$NAME `echo no` \\\n');
  });

  it('strip leading tabs with <<-, from the body and the delimiter line', async () => {
    const m = boot();
    expect((await m.exec('cat <<-EOF\n\tone\n\t\ttwo\n\tEOF')).stdout).toBe('one\ntwo\n');
  });

  it('feed a pipeline, and sit beside an output redirect', async () => {
    const m = boot();
    expect((await m.exec('cat <<EOF | grep b\na\nb\nEOF')).stdout).toBe('b\n');
    await m.exec('cat <<EOF > out.txt && echo done >> out.txt\nx\nEOF');
    expect(m.vfs.readText('/home/dewitt/out.txt', ROOT_USER)).toBe('x\ndone\n');
  });

  it('read bodies in order when one line opens two, and the last one is stdin', async () => {
    const m = boot();
    expect((await m.exec('cat <<A <<B\none\nA\ntwo\nB')).stdout).toBe('two\n');
  });

  it('carry on with the next statement after the delimiter', async () => {
    const m = boot();
    const r = await m.exec("cat > n <<'EOF'\nnote\nEOF\ncat n\necho after");
    expect(r.stdout).toBe('note\nafter\n');
  });

  it('give an empty body for a delimiter on the very next line', async () => {
    const m = boot();
    await m.exec("cat > empty <<'EOF'\nEOF");
    expect(m.vfs.readText('/home/dewitt/empty', ROOT_USER)).toBe('');
  });

  it('run what they have when the input ends first, and say so, like bash', async () => {
    const m = boot();
    const r = await m.exec('cat <<EOF\nnever closed');
    expect(r.stdout).toBe('never closed\n');
    expect(r.stderr).toContain("here-document delimited by end-of-file (wanted 'EOF')");
  });

  it('refuse a << with nothing after it', async () => {
    const m = boot();
    const r = await m.exec('cat <<');
    expect(r.code).toBe(2);
    expect(r.stderr).toContain("expected a delimiter after '<<'");
  });

  it('work inside a script file', async () => {
    const m = boot();
    m.vfs.writeText(
      '/home/dewitt/make.sh',
      "#!/bin/sh\ncat > made.txt <<EOF\nby $1\nEOF\ncat made.txt\n",
      { uid: 1000, gid: 1000, name: 'dewitt' },
    );
    m.vfs.chmod('/home/dewitt/make.sh', 0o755, ROOT_USER);
    expect((await m.exec('./make.sh Vasquez')).stdout).toBe('by Vasquez\n');
  });
});

describe('needsMoreInput', () => {
  it('is true while a here-document is open, and false once it closes', () => {
    expect(needsMoreInput("cat > f <<'EOF'")).toBe(true);
    expect(needsMoreInput("cat > f <<'EOF'\nprint(1)")).toBe(true);
    expect(needsMoreInput("cat > f <<'EOF'\nprint(1)\nEOF")).toBe(false);
  });

  it('is false for ordinary lines and for lines that are simply wrong', () => {
    expect(needsMoreInput('ls -l')).toBe(false);
    expect(needsMoreInput("echo 'unterminated")).toBe(false);
    expect(needsMoreInput('cat <<')).toBe(false);
  });
});
