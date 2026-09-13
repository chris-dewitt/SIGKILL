import { describe, expect, it } from 'vitest';
import { Machine } from '../src/machine.js';
import { ROOT_USER } from '../src/vfs/vfs.js';

/**
 * A shell that cannot run a shell script is not teaching anybody a shell.
 *
 * The lesson under test is the executable bit: a file becomes a program when
 * somebody gives it permission to be one, and that is the single most common
 * thing a new operator gets wrong. Every assertion here is about what the
 * player sees when they get it wrong, because that is the part that teaches.
 */
function boot(): Machine {
  const m = new Machine({ hostname: 'nav7' });
  const v = m.vfs;
  v.mkdirp('/home/survivor', ROOT_USER);
  v.chown('/home/survivor', 1000, 1000, ROOT_USER);
  v.mkdirp('/usr/local/bin', ROOT_USER);
  v.mkdirp('/etc/hull', ROOT_USER);
  v.writeText('/etc/hull/c7.conf', 'NAME=aft crawl\nSEALED=no\n', ROOT_USER);
  v.chmod('/etc/hull/c7.conf', 0o666, ROOT_USER);
  m.shell.cwd = '/home/survivor';
  m.shell.user = { uid: 1000, gid: 1000, name: 'survivor' };
  return m;
}

function script(m: Machine, path: string, lines: string[], mode = 0o644): void {
  m.vfs.writeText(path, lines.join('\n') + '\n', ROOT_USER);
  m.vfs.chmod(path, mode, ROOT_USER);
  m.vfs.chown(path, 1000, 1000, ROOT_USER);
}

describe('a file with the execute bit is a program', () => {
  it('refuses to run a script that is not executable, and says why', async () => {
    const m = boot();
    script(m, '/home/survivor/hello.sh', ['#!/bin/sh', 'echo hello']);
    const r = await m.exec('./hello.sh');
    expect(r.stderr).toBe('sh: ./hello.sh: Permission denied\n');
    expect(r.code).toBe(126);
    expect(r.stdout).toBe('');
  });

  it('runs it once chmod +x has been used', async () => {
    const m = boot();
    script(m, '/home/survivor/hello.sh', ['#!/bin/sh', 'echo hello']);
    expect((await m.exec('chmod +x hello.sh')).stderr).toBe('');
    const r = await m.exec('./hello.sh');
    expect(r.stderr).toBe('');
    expect(r.stdout).toBe('hello\n');
    expect(r.code).toBe(0);
  });

  it('distinguishes a missing script from an unexecutable one', async () => {
    const m = boot();
    const r = await m.exec('./nope.sh');
    expect(r.stderr).toBe('sh: ./nope.sh: No such file or directory\n');
    expect(r.code).toBe(127);
  });

  it('still says command not found for a bare word that is nowhere', async () => {
    const m = boot();
    const r = await m.exec('frobnicate');
    expect(r.stderr).toBe('sh: frobnicate: command not found\n');
    expect(r.code).toBe(127);
  });

  it('finds an executable script on PATH by bare name', async () => {
    const m = boot();
    script(m, '/usr/local/bin/hull-check', ['#!/bin/sh', 'echo checking'], 0o755);
    expect((await m.exec('hull-check')).stdout).toBe('checking\n');
  });

  it('reports permission denied for a PATH hit missing its mode bits', async () => {
    const m = boot();
    script(m, '/usr/local/bin/hull-check', ['#!/bin/sh', 'echo checking'], 0o644);
    const r = await m.exec('hull-check');
    expect(r.stderr).toBe('sh: hull-check: Permission denied\n');
    expect(r.code).toBe(126);
  });

  it('will not try to execute a directory', async () => {
    const m = boot();
    const r = await m.exec('./..');
    expect(r.stderr).toContain('Is a directory');
    expect(r.code).toBe(126);
  });
});

describe('a script gets its arguments', () => {
  it('expands $1 and $0 and $#', async () => {
    const m = boot();
    script(m, '/home/survivor/args.sh', ['#!/bin/sh', 'echo "$0 got $# : $1 $2"'], 0o755);
    expect((await m.exec('./args.sh alpha beta')).stdout).toBe(
      '/home/survivor/args.sh got 2 : alpha beta\n',
    );
  });

  it('expands $@ across every argument', async () => {
    const m = boot();
    script(m, '/home/survivor/all.sh', ['#!/bin/sh', 'echo $@'], 0o755);
    expect((await m.exec('./all.sh a b c')).stdout).toBe('a b c\n');
  });

  it('leaves a missing argument empty rather than literal', async () => {
    const m = boot();
    script(m, '/home/survivor/args.sh', ['#!/bin/sh', 'echo "[$1]"'], 0o755);
    expect((await m.exec('./args.sh')).stdout).toBe('[]\n');
  });

  it('does not leak positional parameters into the interactive shell', async () => {
    const m = boot();
    script(m, '/home/survivor/args.sh', ['#!/bin/sh', 'echo $1'], 0o755);
    await m.exec('./args.sh leaked');
    expect((await m.exec('echo "[$1]"')).stdout).toBe('[]\n');
  });
});

describe('what a script changes and what it does not', () => {
  it('changes the filesystem for real', async () => {
    const m = boot();
    script(m, '/home/survivor/seal.sh', [
      '#!/bin/sh',
      'sed -i "s/^SEALED=.*/SEALED=yes/" /etc/hull/$1.conf',
      'echo "sealed: $1"',
    ], 0o755);
    const r = await m.exec('./seal.sh c7');
    expect(r.stderr).toBe('');
    expect(r.stdout).toBe('sealed: c7\n');
    expect(m.vfs.readText('/etc/hull/c7.conf', ROOT_USER)).toContain('SEALED=yes');
  });

  it('keeps its own cd and its own variables to itself', async () => {
    const m = boot();
    script(m, '/home/survivor/wander.sh', ['#!/bin/sh', 'cd /etc', 'MARK=inside'], 0o755);
    await m.exec('./wander.sh');
    expect((await m.exec('pwd')).stdout).toBe('/home/survivor\n');
    expect((await m.exec('echo "[$MARK]"')).stdout).toBe('[]\n');
  });

  it('exits the script, not the session', async () => {
    const m = boot();
    script(m, '/home/survivor/bail.sh', ['#!/bin/sh', 'exit 3', 'echo unreachable'], 0o755);
    const r = await m.exec('./bail.sh');
    expect(r.stdout).toBe('');
    expect(r.code).toBe(3);
    expect(m.exited).toBeNull();
  });

  it('runs as the caller and gains no privilege of its own', async () => {
    const m = boot();
    m.vfs.writeText('/etc/secret', 'classified\n', ROOT_USER);
    m.vfs.chmod('/etc/secret', 0o600, ROOT_USER);
    script(m, '/home/survivor/peek.sh', ['#!/bin/sh', 'cat /etc/secret'], 0o755);
    const r = await m.exec('./peek.sh');
    expect(r.stdout).toBe('');
    expect(r.stderr).toContain('Permission denied');
  });

  it('stops a script that runs itself instead of hanging', async () => {
    const m = boot();
    script(m, '/home/survivor/loop.sh', ['#!/bin/sh', './loop.sh'], 0o755);
    const r = await m.exec('./loop.sh');
    expect(r.stderr).toContain('nested too deeply');
  });
});

describe('shebangs', () => {
  it('treats a file with no shebang as sh', async () => {
    const m = boot();
    script(m, '/home/survivor/bare.sh', ['echo plain'], 0o755);
    expect((await m.exec('./bare.sh')).stdout).toBe('plain\n');
  });

  it('accepts /usr/bin/env sh', async () => {
    const m = boot();
    script(m, '/home/survivor/env.sh', ['#!/usr/bin/env sh', 'echo via env'], 0o755);
    expect((await m.exec('./env.sh')).stdout).toBe('via env\n');
  });

  it('does not run the shebang line as a command', async () => {
    const m = boot();
    script(m, '/home/survivor/quiet.sh', ['#!/bin/sh', 'echo body'], 0o755);
    const r = await m.exec('./quiet.sh');
    expect(r.stderr).toBe('');
    expect(r.stdout).toBe('body\n');
  });

  it('names an interpreter it does not have rather than guessing', async () => {
    const m = boot();
    script(m, '/home/survivor/weird.sh', ['#!/usr/bin/perl', 'print "hi"'], 0o755);
    const r = await m.exec('./weird.sh');
    expect(r.stderr).toContain('bad interpreter');
    expect(r.code).toBe(126);
  });
});

describe('redirection and pipes reach a script', () => {
  it('captures a script stdout into a file', async () => {
    const m = boot();
    script(m, '/home/survivor/emit.sh', ['#!/bin/sh', 'echo one', 'echo two'], 0o755);
    await m.exec('./emit.sh > out.txt');
    expect(m.vfs.readText('/home/survivor/out.txt', ROOT_USER)).toBe('one\ntwo\n');
  });

  it('pipes a script into another command', async () => {
    const m = boot();
    script(m, '/home/survivor/emit.sh', ['#!/bin/sh', 'echo one', 'echo two'], 0o755);
    expect((await m.exec('./emit.sh | wc -l')).stdout.trim()).toBe('2');
  });
});
