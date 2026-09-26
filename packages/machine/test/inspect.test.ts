import { describe, expect, it } from 'vitest';
import { Machine } from '../src/machine.js';
import { ROOT_USER } from '../src/vfs/vfs.js';

/** A machine with a workspace the unprivileged default user owns. */
function ship(): Machine {
  const m = new Machine();
  m.vfs.mkdirp('/work', ROOT_USER);
  m.vfs.chown('/work', 1000, 1000, ROOT_USER);
  return m;
}

/**
 * Write a file the player can actually edit.
 *
 * Writing as root inside a directory the player owns leaves a root-owned
 * file, and then `sed -i` correctly refuses it -- which reads as a broken
 * command and is really a broken fixture.
 */
function put(m: Machine, path: string, text: string): void {
  m.vfs.writeText(path, text, ROOT_USER);
  m.vfs.chown(path, 1000, 1000, ROOT_USER);
}

describe('realpath', () => {
  it('resolves symlinks, dots and all', async () => {
    const m = ship();
    m.vfs.writeText('/work/real.txt', 'x\n', ROOT_USER);
    m.vfs.symlink('/work/real.txt', '/work/link.txt', ROOT_USER);
    expect((await m.exec('realpath /work/link.txt')).stdout.trim()).toBe('/work/real.txt');
    expect((await m.exec('realpath /work/./../work')).stdout.trim()).toBe('/work');
  });

  it('fails on a link that points nowhere, which is the useful answer', async () => {
    const m = ship();
    m.vfs.symlink('/mnt/never/mounted', '/work/broken', ROOT_USER);
    const r = await m.exec('realpath /work/broken');
    expect(r.code).toBe(1);
    expect(r.stderr).toContain('No such file or directory');
  });
});

describe('file', () => {
  it('tells text from data from a directory from a link', async () => {
    const m = ship();
    m.vfs.writeText('/work/note.txt', 'hello\n', ROOT_USER);
    m.vfs.write('/work/blob.bin', new Uint8Array([0, 1, 2, 3, 0]), ROOT_USER);
    m.vfs.writeText('/work/empty', '', ROOT_USER);
    m.vfs.symlink('/work/note.txt', '/work/link', ROOT_USER);

    expect((await m.exec('file /work/note.txt')).stdout).toContain('ASCII text');
    expect((await m.exec('file /work/blob.bin')).stdout).toContain('data');
    expect((await m.exec('file /work/empty')).stdout).toContain('empty');
    expect((await m.exec('file /work')).stdout).toContain('directory');
    expect((await m.exec('file /work/link')).stdout).toContain('symbolic link to /work/note.txt');
  });

  it('names the interpreter of a script, and says when it cannot run', async () => {
    const m = ship();
    m.vfs.writeText('/work/go.sh', '#!/bin/sh\necho hi\n', ROOT_USER);
    m.vfs.chmod('/work/go.sh', 0o644, ROOT_USER);
    const quiet = (await m.exec('file /work/go.sh')).stdout;
    expect(quiet).toContain('sh script');
    // The execute bit is a puzzle in this game, so `file` has to mention it.
    expect(quiet).toContain('not executable');

    m.vfs.chmod('/work/go.sh', 0o755, ROOT_USER);
    expect((await m.exec('file /work/go.sh')).stdout).not.toContain('not executable');
  });

  it('sees through /usr/bin/env to the real interpreter', async () => {
    const m = ship();
    m.vfs.writeText('/work/go.py', '#!/usr/bin/env python3\nprint(1)\n', ROOT_USER);
    expect((await m.exec('file /work/go.py')).stdout).toContain('python3 script');
  });

  it('flags a broken link as broken', async () => {
    const m = ship();
    m.vfs.symlink('/nowhere', '/work/dead', ROOT_USER);
    expect((await m.exec('file /work/dead')).stdout).toContain('(broken)');
  });
});

describe('type', () => {
  it('knows a builtin from a file on PATH from nothing at all', async () => {
    const m = ship();
    expect((await m.exec('type ls')).stdout).toContain('shell builtin');

    m.vfs.mkdirp('/usr/local/bin', ROOT_USER);
    m.vfs.writeText('/usr/local/bin/widget', '#!/bin/sh\n', ROOT_USER);
    m.vfs.chmod('/usr/local/bin/widget', 0o755, ROOT_USER);
    expect((await m.exec('type widget')).stdout).toContain('/usr/local/bin/widget');

    const missing = await m.exec('type nosuchthing');
    expect(missing.code).toBe(1);
    expect(missing.stderr).toContain('not found');
  });

  /*
   * A file on PATH without an execute bit is not a command, and saying it is
   * would teach exactly the wrong lesson in a game whose third puzzle is the
   * execute bit.
   */
  it('does not call an unexecutable file a command', async () => {
    const m = ship();
    m.vfs.mkdirp('/usr/local/bin', ROOT_USER);
    m.vfs.writeText('/usr/local/bin/inert', '#!/bin/sh\n', ROOT_USER);
    m.vfs.chmod('/usr/local/bin/inert', 0o644, ROOT_USER);
    expect((await m.exec('type inert')).code).toBe(1);
  });
});

describe('diff', () => {
  it('says nothing and exits 0 when two files match', async () => {
    const m = ship();
    m.vfs.writeText('/work/a', 'one\ntwo\n', ROOT_USER);
    m.vfs.writeText('/work/b', 'one\ntwo\n', ROOT_USER);
    const r = await m.exec('diff /work/a /work/b');
    expect(r.code).toBe(0);
    expect(r.stdout).toBe('');
  });

  it('shows the changed line from both sides and exits 1', async () => {
    const m = ship();
    m.vfs.writeText('/work/a', 'O2_TARGET=16\nDUTY=0.4\n', ROOT_USER);
    m.vfs.writeText('/work/b', 'O2_TARGET=21\nDUTY=0.4\n', ROOT_USER);
    const r = await m.exec('diff /work/a /work/b');
    expect(r.code).toBe(1);
    expect(r.stdout).toContain('< O2_TARGET=16');
    expect(r.stdout).toContain('> O2_TARGET=21');
    expect(r.stdout).not.toContain('DUTY');
  });

  it('-q says only that they differ', async () => {
    const m = ship();
    m.vfs.writeText('/work/a', 'one\n', ROOT_USER);
    m.vfs.writeText('/work/b', 'two\n', ROOT_USER);
    const r = await m.exec('diff -q /work/a /work/b');
    expect(r.code).toBe(1);
    expect(r.stdout).toContain('differ');
    expect(r.stdout).not.toContain('one');
  });

  it('reports a missing file rather than pretending it is empty', async () => {
    const m = ship();
    m.vfs.writeText('/work/a', 'one\n', ROOT_USER);
    const r = await m.exec('diff /work/a /work/nope');
    expect(r.code).toBe(2);
    expect(r.stderr).toContain('nope');
  });
});

describe('xargs', () => {
  it('turns a pipe into arguments', async () => {
    const m = ship();
    m.vfs.writeText('/work/one.txt', 'ONE\n', ROOT_USER);
    m.vfs.writeText('/work/two.txt', 'TWO\n', ROOT_USER);
    const r = await m.exec('ls /work | xargs -n 1 echo saw');
    expect(r.stdout).toContain('saw one.txt');
    expect(r.stdout).toContain('saw two.txt');
  });

  it('batches everything into one run without -n', async () => {
    const m = ship();
    const r = await m.exec('echo a b c | xargs echo');
    expect(r.stdout.trim()).toBe('a b c');
  });

  it('feeds real filenames to a real command', async () => {
    const m = ship();
    m.vfs.writeText('/work/a.txt', 'alpha\n', ROOT_USER);
    m.vfs.writeText('/work/b.txt', 'beta\n', ROOT_USER);
    const r = await m.exec('ls /work/*.txt | xargs cat');
    expect(r.stdout).toContain('alpha');
    expect(r.stdout).toContain('beta');
  });

  it('does nothing on empty input rather than running a bare command', async () => {
    const m = ship();
    const r = await m.exec('echo -n "" | xargs echo nothing');
    expect(r.code).toBe(0);
    expect(r.stdout.trim()).toBe('');
  });
});

describe('sed addresses', () => {
  const text = 'one\ntwo\nthree\nfour\nfive\n';

  it('prints a range with -n', async () => {
    const m = ship();
    put(m, '/work/f', text);
    expect((await m.exec("sed -n '2,4p' /work/f")).stdout).toBe('two\nthree\nfour\n');
  });

  it('prints one line, and the last line with $', async () => {
    const m = ship();
    put(m, '/work/f', text);
    expect((await m.exec("sed -n '3p' /work/f")).stdout).toBe('three\n');
    expect((await m.exec("sed -n '$p' /work/f")).stdout).toBe('five\n');
  });

  /*
   * Without -n, `p` prints the whole file and the range a second time. That
   * is real sed, it surprises everybody exactly once, and getting it wrong
   * here would teach a habit that breaks on a real machine.
   */
  it('without -n prints everything and the range again', async () => {
    const m = ship();
    put(m, '/work/f', text);
    const out = (await m.exec("sed '2p' /work/f")).stdout;
    expect(out).toBe('one\ntwo\ntwo\nthree\nfour\nfive\n');
  });

  it('deletes a range', async () => {
    const m = ship();
    put(m, '/work/f', text);
    expect((await m.exec("sed '2,4d' /work/f")).stdout).toBe('one\nfive\n');
  });

  it('works down a pipe and in place', async () => {
    const m = ship();
    put(m, '/work/f', text);
    expect((await m.exec("cat /work/f | sed -n '1p'")).stdout).toBe('one\n');

    await m.exec("sed -i '1,2d' /work/f");
    expect(m.vfs.readText('/work/f', ROOT_USER)).toBe('three\nfour\nfive\n');
  });

  it('still refuses a script it does not implement, and names what it has', async () => {
    const m = ship();
    put(m, '/work/f', text);
    const r = await m.exec("sed 'y/abc/xyz/' /work/f");
    expect(r.code).toBe(2);
    expect(r.stderr).toContain('1,3p');
  });

  it('did not break substitution', async () => {
    const m = ship();
    put(m, '/work/f', 'O2_TARGET=16\n');
    await m.exec("sed -i 's/^O2_TARGET=.*/O2_TARGET=21/' /work/f");
    expect(m.vfs.readText('/work/f', ROOT_USER)).toBe('O2_TARGET=21\n');
  });
});

describe('readlink', () => {
  it('prints the target, including one that does not exist', async () => {
    const m = ship();
    m.vfs.writeText('/work/real.txt', 'x\n', ROOT_USER);
    m.vfs.symlink('/work/real.txt', '/work/good', ROOT_USER);
    m.vfs.symlink('/mnt/never/mounted', '/work/dead', ROOT_USER);

    expect((await m.exec('readlink /work/good')).stdout.trim()).toBe('/work/real.txt');
    // The whole reason it exists alongside realpath: a dangling link still
    // says where it meant to go, and that is the only thing left to learn.
    const dead = await m.exec('readlink /work/dead');
    expect(dead.code).toBe(0);
    expect(dead.stdout.trim()).toBe('/mnt/never/mounted');
  });

  it('exits 1 quietly on something that is not a link', async () => {
    const m = ship();
    m.vfs.writeText('/work/plain.txt', 'x\n', ROOT_USER);
    const r = await m.exec('readlink /work/plain.txt');
    expect(r.code).toBe(1);
    expect(r.stderr, 'real readlink is silent here').toBe('');
  });

  it('-f chases the whole chain', async () => {
    const m = ship();
    m.vfs.writeText('/work/real.txt', 'x\n', ROOT_USER);
    m.vfs.symlink('/work/real.txt', '/work/one', ROOT_USER);
    m.vfs.symlink('/work/one', '/work/two', ROOT_USER);
    expect((await m.exec('readlink /work/two')).stdout.trim()).toBe('/work/one');
    expect((await m.exec('readlink -f /work/two')).stdout.trim()).toBe('/work/real.txt');
  });
});
