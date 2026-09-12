import { beforeEach, describe, expect, it } from 'vitest';
import { FsError } from '../src/errors.js';
import type { User } from '../src/vfs/types.js';
import { ROOT_USER, Vfs } from '../src/vfs/vfs.js';

const alice: User = { uid: 1000, gid: 1000, name: 'alice' };
const bob: User = { uid: 1001, gid: 1001, name: 'bob' };

describe('Vfs', () => {
  let vfs: Vfs;

  beforeEach(async () => {
    vfs = new Vfs();
    vfs.mkdirp('/home/alice', ROOT_USER);
    vfs.chown('/home/alice', alice.uid, alice.gid, ROOT_USER);
  });

  it('round-trips text', async () => {
    vfs.writeText('/home/alice/notes', 'hello\n', alice);
    expect(vfs.readText('/home/alice/notes', alice)).toBe('hello\n');
  });

  it('reports ENOENT for a missing file', async () => {
    expect(() => vfs.readText('/nope', alice)).toThrowError(FsError);
    try {
      vfs.readText('/nope', alice);
    } catch (e) {
      expect((e as FsError).code).toBe('ENOENT');
    }
  });

  it('refuses to read a directory', async () => {
    try {
      vfs.read('/home', alice);
      expect.unreachable('should have thrown EISDIR');
    } catch (e) {
      expect((e as FsError).code).toBe('EISDIR');
    }
  });

  it('enforces read permissions', async () => {
    vfs.writeText('/home/alice/secret', 'classified', alice);
    vfs.chmod('/home/alice/secret', 0o600, alice);
    expect(() => vfs.readText('/home/alice/secret', bob)).toThrowError(/EACCES/);
    expect(vfs.readText('/home/alice/secret', alice)).toBe('classified');
  });

  it('lets root through any permission check', async () => {
    vfs.writeText('/home/alice/secret', 'classified', alice);
    vfs.chmod('/home/alice/secret', 0o000, alice);
    expect(vfs.readText('/home/alice/secret', ROOT_USER)).toBe('classified');
  });

  it('needs +x on a directory to traverse it', async () => {
    vfs.mkdir('/home/alice/vault', alice);
    vfs.writeText('/home/alice/vault/key', 'k', alice);
    vfs.chmod('/home/alice/vault', 0o600, alice);
    expect(() => vfs.readText('/home/alice/vault/key', alice)).toThrowError(/EACCES/);
  });

  it('follows symlinks, including through directories', async () => {
    vfs.writeText('/home/alice/real', 'payload', alice);
    vfs.symlink('/home/alice/real', '/home/alice/link', alice);
    expect(vfs.readText('/home/alice/link', alice)).toBe('payload');
    expect(vfs.realpath('/home/alice/link', alice)).toBe('/home/alice/real');
    expect(vfs.lstat('/home/alice/link', alice).kind).toBe('symlink');
    expect(vfs.stat('/home/alice/link', alice).kind).toBe('file');
  });

  it('detects symlink loops instead of hanging', async () => {
    vfs.symlink('/home/alice/b', '/home/alice/a', alice);
    vfs.symlink('/home/alice/a', '/home/alice/b', alice);
    expect(() => vfs.readText('/home/alice/a', alice)).toThrowError(/ELOOP/);
  });

  it('refuses to rmdir a non-empty directory', async () => {
    vfs.mkdir('/home/alice/full', alice);
    vfs.writeText('/home/alice/full/x', '', alice);
    expect(() => vfs.rmdir('/home/alice/full', alice)).toThrowError(/ENOTEMPTY/);
  });

  it('round-trips a snapshot exactly', async () => {
    vfs.writeText('/home/alice/a', 'one', alice);
    vfs.mkdir('/home/alice/dir', alice);
    vfs.symlink('/home/alice/a', '/home/alice/l', alice);
    vfs.chmod('/home/alice/a', 0o640, alice);

    const restored = Vfs.restore(vfs.snapshot());

    expect(restored.readText('/home/alice/a', alice)).toBe('one');
    expect(restored.readdir('/home/alice', alice)).toEqual(['a', 'dir', 'l']);
    expect(restored.readlink('/home/alice/l', alice)).toBe('/home/alice/a');
    expect(restored.stat('/home/alice/a', alice).mode).toBe(0o640);
    expect(restored.snapshot()).toEqual(vfs.snapshot());
  });

  it('preserves binary content through a snapshot', async () => {
    const bytes = new Uint8Array([0, 1, 127, 128, 255]);
    vfs.write('/home/alice/bin', bytes, alice);
    const restored = Vfs.restore(vfs.snapshot());
    expect([...restored.read('/home/alice/bin', alice)]).toEqual([...bytes]);
  });

  it('uses the virtual clock, never wall time', async () => {
    let clock = 0;
    const timed = new Vfs({ now: () => clock });
    timed.writeText('/a', 'x', ROOT_USER);
    expect(timed.stat('/a', ROOT_USER).mtime).toBe(0);
    clock = 5000;
    timed.writeText('/a', 'y', ROOT_USER);
    expect(timed.stat('/a', ROOT_USER).mtime).toBe(5000);
  });
});
